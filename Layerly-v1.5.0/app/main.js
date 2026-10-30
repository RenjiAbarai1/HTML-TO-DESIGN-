const $=id=>document.getElementById(id);
let hasCapture=false, busy=false;
const toast=(msg,error=false)=>{const n=document.createElement('div');n.className='toast'+(error?' error':'');n.textContent=msg;$('toasts').appendChild(n);setTimeout(()=>n.remove(),5500)};
const setBusy=(working)=>{busy=working;$('capture').disabled=working;$('captlabel').textContent=working?'Converting…':'Convert website';$('working').classList.toggle('hidden',!working);if(working){$('preview').classList.add('hidden');$('previewarea').classList.remove('has-preview');$('empty').classList.add('hidden');$('state').textContent='CAPTURING';$('captureNotes').classList.add('hidden');$('captureActions').classList.add('hidden');}};
function showResult(r){hasCapture=true;$('preview').onload=()=>{$('preview').classList.remove('hidden');$('previewarea').classList.add('has-preview');$('previewarea').scrollTop=0};$('preview').onerror=()=>{$('report').textContent='Capture ready; preview image could not be displayed.'};$('preview').src='/api/preview?t='+Date.now();$('empty').classList.add('hidden');$('state').textContent='READY TO IMPORT';$('report').textContent=`${r.nodes} editable-layer candidates · ${r.images.embedded}/${r.images.found} images embedded`;let p=r.page;$('dimensions').textContent=`${p.width} × ${p.height}`;$('dockSummary').textContent=`${r.nodes} layers · ${r.images.embedded} images ready`;$('captureActions').classList.remove('hidden');document.querySelector('.dot').classList.add('success');const warnings=r.warnings||[];$('captureNotes').classList.toggle('hidden',!warnings.length);$('notesSummary').textContent=`${warnings.length} capture note${warnings.length===1?'':'s'}`;$('notesList').replaceChildren(...warnings.map(note=>{const li=document.createElement('li');li.textContent=note;return li}));}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitForCapture(){
 const deadline=Date.now()+300000;
 while(Date.now()<deadline){
  await delay(900);
  const response=await fetch('/api/status',{cache:'no-store'});
  if(!response.ok)throw Error(`Local capture server returned ${response.status}`);
  const body=await response.json();
  $('workingMsg').textContent=body.message||'Rendering elements, images and layouts…';
  if(body.state==='complete'&&body.result)return body.result;
  if(body.state==='error')throw Error(body.message||'Capture failed');
 }
 throw Error('Capture exceeded five minutes. Try disabling high-res images or using a smaller viewport.');
}
async function capture(){if(busy)return;const url=$('url').value.trim();if(!url){toast('Paste a website URL first.',true);$('url').focus();return}const opts={fullPage:$('full').checked};document.querySelectorAll('[data-opt]').forEach(el=>opts[el.dataset.opt]=el.checked);setBusy(true);$('workingMsg').textContent='Starting Chrome capture…';try{let response=await fetch('/api/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,options:opts,viewport:{width:Number($('viewport').value),height:900}})});let body=await response.json();if(!response.ok)throw new Error(body.error||'Capture failed');const result=await waitForCapture();showResult(result);toast(`Converted ${result.nodes} elements. Now import it in Figma.`)}catch(e){$('state').textContent='FAILED';$('empty').classList.remove('hidden');$('report').textContent=e.message;toast(e.message,true)}finally{setBusy(false);}}
$('capture').addEventListener('click',capture);$('url').addEventListener('keydown',e=>{if(e.key==='Enter')capture()});$('paste').onclick=async()=>{try{$('url').value=await navigator.clipboard.readText();}catch(e){toast('Paste into the URL field using Cmd/Ctrl + V.')}};
$('demo').onclick=()=>{$('url').value='http://localhost:4837/demo.html';capture()};
function needCapture(){if(!hasCapture){toast('Convert a website first.',true);return false}return true}
function openGuide(){if(hasCapture){$('guideTitle').innerHTML='Bring this capture<br>into Figma.';$('guideIntro').textContent='Open the installed Layerly plugin in Figma and choose Import latest capture. Your URL and settings are already captured.';$('guideSteps').innerHTML='<li>In Figma, open <b>Plugins → Development → Layerly — Website to editable design</b>.</li><li>Choose <b>Import latest capture</b>.</li>';}else{$('guideTitle').innerHTML='Paste and convert<br>inside Figma.';$('guideIntro').textContent='Open the Layerly plugin in Figma, paste a public URL, choose your options, and use Convert & Import.';$('guideSteps').innerHTML='<li>In Figma, open <b>Plugins → Development → Layerly — Website to editable design</b>.</li><li>Paste the link and choose <b>Convert &amp; Import</b>.</li>';}$('guide').showModal()}
$('figma').onclick=()=>{if(needCapture())openGuide()};$('setup').onclick=openGuide;$('how').onclick=openGuide;$('close').onclick=()=>$('guide').close();$('gotit').onclick=()=>$('guide').close();$('guide').onclick=e=>{if(e.target===$('guide'))$('guide').close()};
$('capturefile').onclick=()=>{if(needCapture())window.location.href='/api/download'};
$('figmasvg').onclick=()=>{if(needCapture())window.location.href='/api/figma-svg'};
$('dockDownload').onclick=()=>{if(needCapture())window.location.href='/api/download'};
$('dockFigma').onclick=()=>{if(needCapture())openGuide()};
fetch('/api/status').then(r=>r.json()).then(v=>{if(v.hasCapture){fetch('/api/latest').then(r=>r.json()).then(r=>showResult({nodes:r.tree?.length||0,images:r.imageStats||{found:0,embedded:0},page:r.page||{width:0,height:0},warnings:r.warnings||[]}))}}).catch(()=>{});
