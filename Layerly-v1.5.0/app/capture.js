/* Runs inside the webpage being converted. No extension globals here. */
function layerlyCapture(opts) {
  const doc=document, tree=[], nodes=[], assetUrls=[], warnings=[];
  const MAX_ITEMS=3500, MAX_HEIGHT=28000;
  const pageW=Math.min(6000,Math.max(doc.documentElement.scrollWidth,innerWidth));
  const pageH=Math.min(MAX_HEIGHT,Math.max(doc.documentElement.scrollHeight,doc.body?.scrollHeight||0,innerHeight));
  const rootURL=location.href;
  const textClean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const col=s=>!s||s==='transparent'||/^rgba?\(0,\s*0,\s*0,\s*0\)/.test(s)?null:s;
  const rgbNeeded=s=>!!col(s);
  const shadow=s=>{
    if(!s||s==='none')return null;
    const m=String(s).match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+/i);
    const nums=String(s).replace(m?.[0]||'','').match(/-?[\d.]+px/g)?.map(Number)||[];
    if(nums.length<2)return null;
    return {color:m?.[0]||'rgba(0,0,0,.18)',x:nums[0]||0,y:nums[1]||0,blur:Math.max(0,nums[2]||0),spread:nums[3]||0};
  };
  const px=value=>Math.round(value*100)/100;
  const safeRect=el=>{const r=el.getBoundingClientRect();return {x:px(r.left+scrollX),y:px(r.top+scrollY),w:Math.max(0,px(r.width)),h:Math.max(0,px(r.height))};};
  const valid=r=>r.w>0&&r.h>0&&r.x>-10000&&r.y>-10000&&r.x<pageW+600&&r.y<pageH+500&&r.w<12000&&r.h<MAX_HEIGHT;
  const label=(el)=>{
    const tag=el.tagName.toLowerCase();if(!opts.layerNames)return tag;
    let cls=typeof el.className==='string'?el.className.trim().split(/\s+/)[0]:'';
    let semantic=el.getAttribute('data-framer-name')||el.getAttribute('aria-label')||'';
    if(!semantic&&/^(h[1-6]|button)$/.test(tag))semantic=textClean(el.innerText).slice(0,48);
    return (semantic?`${tag} / ${semantic.slice(0,48)}`:tag+(el.id?'#'+el.id.slice(0,42):cls?'.'+cls.slice(0,42):''));
  };
  const linked=el=>opts.hyperlinks?(el.closest?.('a[href]')?.href||''):'';
  let scanned=0, nextId=1;
  function add(item) {item.id=nextId++;tree.push(item);return item.id;}
  function pushAsset(src){if(/^(https?:|data:image\/)/i.test(src||''))assetUrls.push(src);}
  function walk(el,parentId,depth) {
    if(!el||depth>44||tree.length>=MAX_ITEMS||nodes.length>3200)return;
    if(el.id==='svg-templates')return;
    scanned++;
    if(/^(SCRIPT|STYLE|META|LINK|NOSCRIPT|TEMPLATE|IFRAME|AUDIO|OBJECT|EMBED)$/i.test(el.tagName))return;
    let style,r;
    try{style=getComputedStyle(el);r=safeRect(el)}catch(_){return}
    if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)<.01)return;
    // Framer and similar builders use zero-size positioning wrappers whose
    // absolutely positioned descendants are visible elsewhere on the page.
    if(!valid(r)){for(const child of el.children)walk(child,parentId,depth+1);return;}
    if(style.display==='contents'){for(const child of el.children)walk(child,parentId,depth+1);return}
    let name=label(el);const tag=el.tagName.toLowerCase(), link=linked(el);
    const bg=col(style.backgroundColor), bw=parseFloat(style.borderTopWidth)||0;
    const border=bw>0?{color:col(style.borderTopColor),width:bw}:null;
    const radius=Math.max(0,parseFloat(style.borderTopLeftRadius)||0),opacity=isFinite(Number(style.opacity))?Number(style.opacity):1;
    const common={parentId,name,tag,...r,opacity,link,zIndex:parseInt(style.zIndex)||0,flexGrow:parseFloat(style.flexGrow)||0,alignSelf:style.alignSelf};
    if(tag==='img'){
      const alt=textClean(el.getAttribute('alt'));
      if(opts.layerNames&&alt){name='image / '+alt.slice(0,72);common.name=name;}
      let src=el.currentSrc||el.src||'';
      if(opts.highResImages&&el.srcset){try{
        const candidates=el.srcset.split(',').map(s=>s.trim().split(/\s+/));
        const ordered=candidates.filter(a=>a.length>1).sort((a,b)=>(parseFloat(b[1])||0)-(parseFloat(a[1])||0));
        if(ordered[0])src=new URL(ordered[0][0],rootURL).href;
      }catch(_){}}
      const id=add({kind:'image',...common,src,fit:style.objectFit||'fill',radius});nodes.push({type:'image',name,...r,src,opacity,link});pushAsset(src);return id;
    }
    if(tag==='canvas'||tag==='video'){
      let src='';
      if(tag==='video')src=el.poster||'';
      else try{src=el.toDataURL('image/png')}catch(_){warnings.push('A cross-origin canvas could not be captured.');}
      if(src){const id=add({kind:'image',...common,src,fit:'fill',radius});nodes.push({type:'image',name,...r,src,opacity,link});pushAsset(src);return id;}
      return;
    }
    if(tag==='svg'){
      try {const clone=el.cloneNode(true);clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width',r.w);clone.setAttribute('height',r.h);
        const svg=new XMLSerializer().serializeToString(clone);add({kind:'svg',...common,svg});nodes.push({type:'svg',name,...r,svg,opacity,link});
      } catch (_){}return;
    }
    const isComponent=(tag==='button'||el.getAttribute('role')==='button'||(tag==='a'&&(
      el.classList.contains('button')||el.classList.contains('btn')||el.classList.contains('cta')||
      ((bg||bw>0||radius>2)&&r.w<520&&r.h<140&&textClean(el.innerText).length<90)
    )));
    const padding={top:parseFloat(style.paddingTop)||0,right:parseFloat(style.paddingRight)||0,bottom:parseFloat(style.paddingBottom)||0,left:parseFloat(style.paddingLeft)||0};
    const backgroundMatch=String(style.backgroundImage||'').match(/url\(["']?([^"')]+)["']?\)/);
    const hasDirectText=[...el.childNodes].some(child=>child.nodeType===Node.TEXT_NODE&&textClean(child.textContent));
    const meaningfulFrame=tag==='body'||isComponent||bg||bw>0||radius>0||shadow(style.boxShadow)||backgroundMatch||hasDirectText||
      ['flex','inline-flex','grid','inline-grid'].includes(style.display)||style.position!=='static'||Object.values(padding).some(value=>value>0);
    if(opts.simplifyLayers&& !meaningfulFrame){
      for(const child of el.children)walk(child,parentId,depth+1);
      return;
    }
    const id=add({kind:'frame',...common,fill:bg,border,radius,isComponent,shadow:shadow(style.boxShadow),
      display:style.display,position:style.position,flexDirection:style.flexDirection,flexWrap:style.flexWrap,
      gap:parseFloat(style.columnGap)||parseFloat(style.gap)||0,rowGap:parseFloat(style.rowGap)||0,
      padding,justify:style.justifyContent,align:style.alignItems,overflow:style.overflow});
    if(bg||bw>0){nodes.push({type:'shape',name:name+' / surface',...r,fill:bg,border,radius,opacity,link});}
    if(backgroundMatch){try{const src=new URL(backgroundMatch[1],rootURL).href;add({kind:'image',parentId:id,tag:'background-image',name:name+' / background',...r,src,opacity,link});nodes.push({type:'image',name:name+' / background',...r,src,opacity,link});pushAsset(src);}catch(_){}}
    for(const child of el.childNodes){
      if(tree.length>=MAX_ITEMS)break;
      if(child.nodeType===Node.TEXT_NODE&&textClean(child.textContent)){
        try{
          const range=doc.createRange();range.selectNodeContents(child);const b=range.getBoundingClientRect();
          const tr={x:px(b.left+scrollX),y:px(b.top+scrollY),w:Math.max(0,px(b.width)),h:Math.max(0,px(b.height))};
          const text=textClean(child.textContent).slice(0,3000);
          if(!valid(tr)||!text)continue;
          const leaf={kind:'text',parentId:id,name:name+' / text',tag:'text',...tr,text,color:style.color,
            fontFamily:style.fontFamily,fontSize:parseFloat(style.fontSize)||16,
            weight:parseInt(style.fontWeight)||400,align:style.textAlign,lineHeight:style.lineHeight,
            letterSpacing:style.letterSpacing,textDecoration:style.textDecorationLine,textTransform:style.textTransform,
            opacity,link};
          add(leaf);nodes.push({type:'text',...leaf});
        }catch(_){}
      } else if(child.nodeType===Node.ELEMENT_NODE)walk(child,id,depth+1);
    }
    return id;
  }
  walk(doc.body,0,0);
  if(tree.length>=MAX_ITEMS)warnings.push('Layer limit reached; some content may be missing.');
  if(doc.querySelector('canvas'))warnings.push('Canvas graphics cannot be reconstructed as native vectors.');
  if(doc.querySelector('video'))warnings.push('Video content is not converted.');
  if(doc.querySelector('iframe'))warnings.push('Cross-origin iframe content is omitted.');
  let hoverRules=[];
  if(opts.hoverEffects){for(const sheet of doc.styleSheets){try{for(const rule of sheet.cssRules||[]){if(rule.selectorText?.includes(':hover'))hoverRules.push(rule.selectorText.slice(0,240));}}catch(_){}}
    hoverRules=hoverRules.slice(0,120);
  }
  let colors={};if(opts.stylesVariables){for(const n of tree){for(const c of [n.fill,n.color,n.border?.color])if(rgbNeeded(c))colors[c]=(colors[c]||0)+1;}}
  return {format:'layerly.capture',version:7,sourceUrl:rootURL,title:doc.title,page:{width:pageW,height:pageH,viewportWidth:innerWidth,viewportHeight:innerHeight},
    capturedAt:new Date().toISOString(),options:opts,tree,nodes,colors,hoverRules,assetUrls:[...new Set(assetUrls)].slice(0,95),warnings,scannedElements:scanned};
}
