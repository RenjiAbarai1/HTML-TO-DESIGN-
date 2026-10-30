#!/usr/bin/env python3
"""Layerly local web-to-Figma capture server. Loopback only; no accounts or cloud."""
import base64, json, io, mimetypes, os, re, socket, sys, threading, time, webbrowser, zipfile
from xml.sax.saxutils import escape, quoteattr
from xml.etree import ElementTree as ET
from PIL import Image, ImageOps, UnidentifiedImageError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote_to_bytes
from ipaddress import ip_address

HERE = Path(__file__).resolve().parent
APP = HERE / 'app'
OUTPUT = HERE / 'output'
OUTPUT.mkdir(exist_ok=True)
PORT = 4837
APP_VERSION = '1.5.0'
lock = threading.Lock()
latest = None
latest_summary = None
status = {'state': 'ready', 'message': 'Ready to convert a website'}

# Figma accepts JPEG/PNG reliably. Sites built with Framer frequently serve
# WebP/AVIF assets, so normalize these to Figma-ready bytes before import.
MAX_IMAGE_BYTES = 4_800_000
MAX_TOTAL_IMAGE_BYTES = 32_000_000

def safe_svg(raw):
    """Keep drawable SVG markup for native Figma vectors, without active content."""
    if len(raw) > 2_000_000:
        raise ValueError('SVG asset exceeds the capture limit')
    root = ET.fromstring(raw)
    if root.tag.rsplit('}', 1)[-1].lower() != 'svg':
        raise ValueError('Image is not SVG')
    blocked = {'script', 'foreignObject', 'iframe', 'object', 'embed', 'animate',
               'animateMotion', 'animateTransform', 'set'}
    def clean(node):
        for child in list(node):
            if child.tag.rsplit('}', 1)[-1] in blocked:
                node.remove(child)
            else:
                clean(child)
        for key, value in list(node.attrib.items()):
            name = key.rsplit('}', 1)[-1].lower()
            if name.startswith('on') or (name == 'href' and not value.startswith('#')) or \
               ('url(' in value.lower() and ('http:' in value.lower() or 'https:' in value.lower())):
                del node.attrib[key]
    clean(root)
    ET.register_namespace('', 'http://www.w3.org/2000/svg')
    return ET.tostring(root, encoding='unicode')

def figma_image_bytes(raw, content_type, high_res=True):
    """Return (MIME, bytes) for a Figma image fill, or raise ValueError.

    This deliberately outputs PNG/JPEG for all accepted raster formats,
    including WebP and AVIF. Downsampling prevents oversized Figma payloads.
    """
    if len(raw) > 16_000_000:
        raise ValueError('Source image exceeds the capture limit')
    with Image.open(io.BytesIO(raw)) as original:
        im = ImageOps.exif_transpose(original)
        if getattr(im, 'is_animated', False):
            im.seek(0)
        im.load()
        max_edge = 3400 if high_res else 1700
        if max(im.size) > max_edge:
            im.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        has_alpha = im.mode in ('RGBA', 'LA') or 'transparency' in im.info
        if has_alpha:
            im = im.convert('RGBA')
            out = io.BytesIO()
            im.save(out, format='PNG', optimize=True, compress_level=6)
            # Very large transparent images can instead use smaller JPEG,
            # but only when transparency is in fact opaque throughout.
            mime = 'image/png'
        else:
            im = im.convert('RGB')
            out = io.BytesIO()
            im.save(out, format='JPEG', quality=87 if high_res else 79, optimize=True)
            mime = 'image/jpeg'
        payload = out.getvalue()
        if len(payload) > MAX_IMAGE_BYTES:
            # Further downsample to keep huge, texture-rich assets portable.
            im.thumbnail((1800, 1800), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            if mime == 'image/png':
                im.save(out, format='PNG', optimize=True)
            else:
                im.save(out, format='JPEG', quality=77, optimize=True)
            payload = out.getvalue()
        if len(payload) > MAX_IMAGE_BYTES:
            raise ValueError('Converted image exceeds the capture limit')
        return mime, payload

def explain_capture_error(exc, url):
    raw = str(exc)
    if 'ERR_BLOCKED_BY_ADMINISTRATOR' in raw:
        return ('Chrome or the computer network blocked browser navigation by policy. '
                'Layerly cannot override that restriction. Try opening the URL in Chrome on your Mac. '
                'If it is blocked there too, use an unrestrained personal browser/network '
                'or ask your administrator. The website itself was not converted.')
    if 'ERR_NAME_NOT_RESOLVED' in raw or 'ENOTFOUND' in raw:
        return 'Website address could not be resolved. Check the URL and internet connection.'
    if 'ERR_CONNECTION_REFUSED' in raw or 'ERR_CONNECTION_CLOSED' in raw:
        return 'Connection refused or closed. The site may be unreachable from this computer.'
    if 'ERR_CERT_' in raw:
        return 'The website has a certificate problem. Open the URL manually in Chrome before retrying.'
    if 'Timeout' in raw or 'timed out' in raw.lower():
        return 'The website took too long to load. Try again or convert a simpler public page.'
    return raw[:1300]


def pick_browser(playwright):
    candidates = [('Chrome', lambda: playwright.chromium.launch(channel='chrome', headless=True, args=['--disable-dev-shm-usage'])),
                  ('Edge', lambda: playwright.chromium.launch(channel='msedge', headless=True, args=['--disable-dev-shm-usage']))]
    if sys.platform == 'darwin':
        candidates += [('Chromium',lambda: playwright.chromium.launch(executable_path='/Applications/Chromium.app/Contents/MacOS/Chromium', headless=True))]
    if sys.platform.startswith('linux'):
        candidates += [('Chromium',lambda: playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox']))]
    candidates += [('Playwright Chromium', lambda: playwright.chromium.launch(headless=True))]
    errors=[]
    for name, launch in candidates:
        try: return launch(), name
        except Exception as e: errors.append(name+': '+str(e)[:120])
    raise RuntimeError('Could not launch Chrome or Chromium. Install Chrome, then retry. Details: ' + ' | '.join(errors))


def validate_url(url):
    url=str(url or '').strip()
    if not re.match(r'^https?://',url,re.I):
        url='https://'+url
    p=urlparse(url)
    if p.scheme not in ('http','https') or not p.hostname or p.username or p.password:
        raise ValueError('Enter a valid http:// or https:// website URL')
    if p.hostname in ('169.254.169.254','metadata.google.internal'):
        raise ValueError('That URL is not permitted')
    return url


def capture_website(url, options, viewport, sample=False):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser, browser_name = pick_browser(pw)
        try:
            width = max(375,min(1920,int(viewport.get('width',1440))))
            height = max(600,min(1080,int(viewport.get('height',900))))
            context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1,
                                        ignore_https_errors=False,service_workers='block',color_scheme='light')
            page=context.new_page()
            page.set_default_timeout(14000)
            demo_mode=urlparse(url).hostname in ('localhost','127.0.0.1') and urlparse(url).path=='/demo.html'
            if demo_mode:
                # Bundled demo works offline and does not require an external website.
                html=(APP/'demo.html').read_text('utf8')
                photo='data:image/jpeg;base64,'+base64.b64encode((APP/'demo-art.jpg').read_bytes()).decode('ascii')
                html=html.replace('src="/demo-art.jpg"','src="'+photo+'"')
                page.set_content(html,wait_until='domcontentloaded')
                response=None
            else:
                try:
                    response=page.goto(url, wait_until='domcontentloaded', timeout=45000)
                except Exception as exc:
                    raise RuntimeError(explain_capture_error(exc, url)) from exc
                if response is not None and response.status >= 400:
                    raise ValueError(f'The website returned HTTP {response.status}. Try a public page.')
            try:page.wait_for_load_state('networkidle',timeout=8000)
            except Exception:pass
            page.wait_for_timeout(800)
            # Load content that appears only once the page has scrolled.
            total=page.evaluate('Math.min(24000,Math.max(document.body?.scrollHeight||0,document.documentElement.scrollHeight))')
            if options.get('fullPage',True):
                for y in range(0, min(total,22000),720):
                    page.evaluate('(y)=>window.scrollTo(0,y)',y)
                    page.wait_for_timeout(85)
            page.evaluate('window.scrollTo(0,0)')
            page.wait_for_timeout(550)
            extractor=(APP/'capture.js').read_text('utf8')
            js_opts={
                'autolayout': bool(options.get('autolayout',True)),
                'editableText': bool(options.get('editableText',False)),
                'components': bool(options.get('components',True)),
                'simplifyLayers': bool(options.get('simplifyLayers',True)),
                'stylesVariables':bool(options.get('stylesVariables',True)),
                'localStyles':bool(options.get('localStyles',False)),
                'hoverEffects':bool(options.get('hoverEffects',False)),
                'highResImages':bool(options.get('highResImages',True)),
                'hyperlinks':bool(options.get('hyperlinks',True)),
                'layerNames':bool(options.get('layerNames',True)),
            }
            data=page.evaluate('({opts}) => {' + extractor + ';return layerlyCapture(opts)}',{'opts':js_opts})
            data['version']=7
            data['renderer']=browser_name
            data['captureOptions']={**options,'viewport':{'width':width,'height':height}}
            data['sourceUrl']=url if demo_mode else page.url
            data['title']=page.title()
            # Browser screenshots serve as a realistic preview, not as editable Figma layers.
            try:
                preview=page.screenshot(type='jpeg',quality=74,full_page=bool(options.get('fullPage',True)),timeout=19000)
            except Exception:
                preview=page.screenshot(type='jpeg',quality=74,full_page=False,timeout=10000)
                data.setdefault('warnings',[]).append('Full page screenshot was too tall; preview shows viewport only.')
            (OUTPUT/'preview.jpg').write_bytes(preview)
            # Separate image asset bytes let the Figma plugin create native image-fill layers.
            asset_urls=data.get('assetUrls',[])[:95]
            image_data={}
            svg_data={}
            used=0
            unsupported=0
            size_limited=0
            timed_out=0
            asset_deadline=time.monotonic()+38
            for index,src in enumerate(asset_urls):
                if time.monotonic()>asset_deadline:
                    timed_out=len(asset_urls)-index
                    break
                if not isinstance(src,str):continue
                # Data URI images can be reconstructed without a network fetch.
                try:
                    if src.startswith('data:image/'):
                        header, encoded=src.split(',',1)
                        typ=header[5:].split(';',1)[0]
                        raw=base64.b64decode(encoded,validate=True) if ';base64' in header else unquote_to_bytes(encoded)
                    elif src.startswith(('https://','http://')):
                        resp=context.request.get(src,timeout=3200,headers={'Referer':page.url})
                        if not resp.ok:continue
                        raw=resp.body()
                        typ=resp.headers.get('content-type','').split(';')[0].lower()
                    else:continue
                    if typ == 'image/svg+xml' or raw.lstrip().startswith(b'<svg'):
                        svg=safe_svg(raw)
                        if used+len(svg.encode('utf8'))>MAX_TOTAL_IMAGE_BYTES:
                            size_limited+=1;continue
                        svg_data[src]=svg
                        used+=len(svg.encode('utf8'))
                        continue
                    mime,payload=figma_image_bytes(raw,typ,options.get('highResImages',True))
                    if used+len(payload)>MAX_TOTAL_IMAGE_BYTES:
                        size_limited+=1;continue
                    image_data[src]='data:'+mime+';base64,'+base64.b64encode(payload).decode('ascii')
                    used+=len(payload)
                except (UnidentifiedImageError, OSError, ValueError):
                    unsupported+=1
                except Exception:
                    pass
            data['images']=image_data
            data['svgAssets']=svg_data
            data['imageStats']={'found':len(asset_urls),'embedded':len(image_data)+len(svg_data),'editableVectors':len(svg_data),'unrecognized':unsupported,'overLimit':size_limited,'skippedToStayResponsive':timed_out}
            data['previewMode']='full-page' if options.get('fullPage',True) else 'viewport'
            if len(asset_urls)>len(image_data)+len(svg_data):
                data.setdefault('warnings',[]).append(f'{len(asset_urls)-len(image_data)-len(svg_data)} image references could not be embedded, including inaccessible or oversized assets.')
            # Save source code for Framer Code/HTML, NOT as native editable Framer canvas.
            html=page.content()
            (OUTPUT/'captured-website.html').write_text(html,'utf8')
            (OUTPUT/'capture.layerly').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),'utf8')
            context.close()
            return data
        finally:browser.close()

def run_capture_job(url, opts, viewport):
    global latest, latest_summary, status
    try:
        status={'state':'working','message':'Rendering the website in Chrome'}
        result=capture_website(url,opts,viewport)
        latest={'title':result.get('title'),'url':url,'nodes':len(result.get('tree',[]))}
        latest_summary={'title':result.get('title'),'url':result.get('sourceUrl'),'nodes':len(result.get('tree',[])),
                        'images':result.get('imageStats',{}),'warnings':result.get('warnings',[]),
                        'page':result.get('page',{}),'capturedAt':result.get('capturedAt')}
        status={'state':'complete','message':'Captured website successfully'}
    except Exception as exc:
        status={'state':'error','message':explain_capture_error(exc, url)}
    finally:
        lock.release()

def make_figma_svg(data):
    page=data.get('page') or {}
    width=max(1,min(6000,int(page.get('width') or 1440)))
    height=max(1,min(28000,int(page.get('height') or 900)))
    images=data.get('images') or {}
    parts=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
           '<rect width="100%" height="100%" fill="white"/>']
    for node in (data.get('nodes') or [])[:5000]:
        try:
            kind=node.get('type') or node.get('kind')
            x=float(node.get('x') or 0);y=float(node.get('y') or 0)
            w=max(0,float(node.get('w') or 0));h=max(0,float(node.get('h') or 0))
            opacity=max(0,min(1,float(node.get('opacity',1))))
            if w<=0 or h<=0:continue
            if kind=='shape':
                fill=node.get('fill') or 'none';border=node.get('border') or {}
                stroke=border.get('color') or 'none';sw=max(0,float(border.get('width') or 0));radius=max(0,float(node.get('radius') or 0))
                parts.append(f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{radius:g}" fill={quoteattr(str(fill))} stroke={quoteattr(str(stroke))} stroke-width="{sw:g}" opacity="{opacity:g}"/>')
            elif kind=='text':
                text=str(node.get('text') or '')
                color=node.get('color') or '#111';size=max(6,float(node.get('fontSize') or 16));family=node.get('fontFamily') or 'Inter';weight=int(node.get('weight') or 400)
                parts.append(f'<text x="{x:g}" y="{y+size:g}" fill={quoteattr(str(color))} font-family={quoteattr(str(family))} font-size="{size:g}" font-weight="{weight}" opacity="{opacity:g}">{escape(text)}</text>')
            elif kind=='image':
                uri=images.get(node.get('src'))
                if uri:parts.append(f'<image x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" href={quoteattr(uri)} preserveAspectRatio="xMidYMid slice" opacity="{opacity:g}"/>')
        except Exception:
            continue
    parts.append('</svg>')
    return ''.join(parts).encode('utf8')

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if not self.path.startswith('/api/status'):
            print('[Layerly]',fmt % args,flush=True)
    def send(self, content, mime='application/json', code=200, headers=None):
        if isinstance(content,str):content=content.encode('utf8')
        self.send_response(code)
        self.send_header('Content-Type',mime)
        self.send_header('Content-Length',str(len(content)))
        self.send_header('Cache-Control','no-store')
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Private-Network','true')
        if headers:
            for name,value in headers.items():self.send_header(name,value)
        self.end_headers();self.wfile.write(content)
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.send_header('Access-Control-Allow-Private-Network','true')
        self.end_headers()
    def do_GET(self):
        p=urlparse(self.path).path
        if p=='/':p='/index.html'
        if p=='/api/status':
            response={**status,'hasCapture':latest is not None,'version':APP_VERSION}
            if status.get('state')=='complete' and latest_summary is not None:response['result']=latest_summary
            return self.send(json.dumps(response))
        if p=='/api/latest':
            file=OUTPUT/'capture.layerly'
            if not file.exists():return self.send(json.dumps({'error':'No capture available. Convert a website in Layerly first.'}),code=404)
            return self.send(file.read_bytes(),'application/json')
        if p=='/api/plugin':
            archive=io.BytesIO()
            with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as bundle:
                for name in ('manifest.json','code.js','ui.html'):
                    bundle.write(HERE/'figma-plugin'/name,arcname='Layerly-Figma-Plugin/'+name)
            return self.send(archive.getvalue(),'application/zip',headers={'Content-Disposition':'attachment; filename="Layerly-Figma-Plugin.zip"'})
        if p=='/api/figma-svg':
            file=OUTPUT/'capture.layerly'
            if not file.exists():return self.send('No capture available. Convert a website first.','text/plain',404)
            data=json.loads(file.read_text('utf8'))
            return self.send(make_figma_svg(data),'image/svg+xml',headers={'Content-Disposition':'attachment; filename="Layerly-Figma-Drop.svg"'})
        files={'/api/preview':(OUTPUT/'preview.jpg','image/jpeg'),
               '/api/download':(OUTPUT/'capture.layerly','application/octet-stream'),
               '/api/html':(OUTPUT/'captured-website.html','text/html; charset=utf-8')}
        if p in files:
            path,mime=files[p]
            if not path.exists():return self.send('Not found','text/plain',404)
            return self.send(path.read_bytes(),mime,headers={'Content-Disposition':f'attachment; filename="{path.name}"'} if p in ('/api/download','/api/html') else None)
        local=(APP/p.lstrip('/')).resolve()
        if APP not in local.parents or not local.is_file():return self.send('Not found','text/plain',404)
        return self.send(local.read_bytes(),mimetypes.guess_type(str(local))[0] or 'application/octet-stream')
    def do_POST(self):
        global status
        if self.path!='/api/capture':return self.send('Not found','text/plain',404)
        acquired=False
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size>20000:raise ValueError('Request too large')
            payload=json.loads(self.rfile.read(size))
            url=validate_url(payload.get('url'))
            opts=payload.get('options') or {}
            viewport=payload.get('viewport') or {}
            if not lock.acquire(blocking=False):return self.send(json.dumps({'error':'Conversion already running. Please wait.'}),code=409)
            acquired=True
            status={'state':'working','message':'Starting Chrome capture'}
            threading.Thread(target=run_capture_job,args=(url,opts,viewport),daemon=True).start()
            acquired=False
            return self.send(json.dumps({'accepted':True,'state':'working'}),code=202)
        except Exception as exc:
            if acquired:
                try:lock.release()
                except RuntimeError:pass
            status={'state':'error','message':str(exc)}
            return self.send(json.dumps({'error':explain_capture_error(exc, '')}),code=400)

class IPv6LoopbackServer(ThreadingHTTPServer):
    """Serve ::1 separately so localhost works with either resolver family."""
    address_family = socket.AF_INET6
    def server_bind(self):
        if hasattr(socket, 'IPV6_V6ONLY'):
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        super().server_bind()

def main():
    global latest, latest_summary
    if not (APP/'index.html').is_file():raise RuntimeError('Missing app/index.html')
    # A successful capture remains usable after the engine is restarted.
    saved=OUTPUT/'capture.layerly'
    if saved.is_file():
        try:
            capture=json.loads(saved.read_text('utf8'))
            if capture.get('format')=='layerly.capture' and isinstance(capture.get('tree'),list):
                latest={'title':capture.get('title'),'url':capture.get('sourceUrl'),'nodes':len(capture['tree'])}
                latest_summary={'title':capture.get('title'),'url':capture.get('sourceUrl'),'nodes':len(capture['tree']),
                                'images':capture.get('imageStats',{}),'warnings':capture.get('warnings',[]),
                                'page':capture.get('page',{}),'capturedAt':capture.get('capturedAt')}
        except (OSError, ValueError, TypeError):
            pass
    servers=[];errors=[]
    for server_type,address in ((ThreadingHTTPServer,('127.0.0.1',PORT)),(IPv6LoopbackServer,('::1',PORT))):
        try:servers.append(server_type(address,Handler))
        except OSError as exc:errors.append(str(exc))
    if not servers:raise RuntimeError('Could not open the local Layerly port: '+' | '.join(errors))
    for background in servers[1:]:threading.Thread(target=background.serve_forever,daemon=True).start()
    print('\n  LAYERLY  |  http://localhost:4837  |  IPv4 + IPv6 loopback\n  Keep this window open while you convert or import.\n',flush=True)
    if '--no-browser' not in sys.argv:
        threading.Timer(1,lambda:webbrowser.open(f'http://localhost:{PORT}')).start()
    try:servers[0].serve_forever()
    except KeyboardInterrupt:pass
    finally:
        for background in servers[1:]:
            try:background.shutdown();background.server_close()
            except Exception:pass
        try:servers[0].server_close()
        except Exception:pass
if __name__=='__main__':main()
