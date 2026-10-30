figma.showUI(__html__,{width:460,height:720,themeColors:true});
const fontCache=new Map();let availableFonts=[];
function rgba(value){
 if(!value||value==='transparent')return null;
 let m=String(value).trim().match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s\/]+([\d.]+))?/i);
 let r,g,b,a=1;
 if(m){r=Number(m[1])/255;g=Number(m[2])/255;b=Number(m[3])/255;if(m[4]!=null)a=Number(m[4]);}
 else if(String(value).startsWith('#')){let hex=String(value).slice(1);if(hex.length===3||hex.length===4)hex=[...hex].map(x=>x+x).join('');if(hex.length!==6&&hex.length!==8)return null;r=parseInt(hex.slice(0,2),16)/255;g=parseInt(hex.slice(2,4),16)/255;b=parseInt(hex.slice(4,6),16)/255;if(hex.length===8)a=parseInt(hex.slice(6,8),16)/255;}
 else if(value==='white'){r=g=b=1;}else if(value==='black'){r=g=b=0;}else return null;
 if(![r,g,b,a].every(Number.isFinite))return null;
 return {color:{r:Math.min(1,Math.max(0,r)),g:Math.min(1,Math.max(0,g)),b:Math.min(1,Math.max(0,b))},opacity:Math.min(1,Math.max(0,a))};
}
function paint(color){const c=rgba(color);return c?[{type:'SOLID',color:c.color,opacity:c.opacity}]:[];}
function effect(shadow){
 const c=rgba(shadow?.color);if(!shadow||!c)return [];
 return [{type:'DROP_SHADOW',color:{...c.color,a:c.opacity},offset:{x:shadow.x||0,y:shadow.y||0},radius:Math.max(0,shadow.blur||0),spread:shadow.spread||0,visible:true,blendMode:'NORMAL'}];
}
function decodeBase64(uri){
 if(typeof uri!=='string'||!uri.includes(';base64,'))return null;
 const b64=uri.split(';base64,')[1],alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
 const clean=b64.replace(/[^A-Za-z0-9+/=]/g,'');const result=[];let acc=0,bits=0;
 for(const ch of clean){if(ch==='=')break;const val=alphabet.indexOf(ch);if(val<0)continue;acc=(acc<<6)|val;bits+=6;if(bits>=8){bits-=8;result.push((acc>>bits)&255);}}
 return new Uint8Array(result);
}
async function getFont(node){
 const families=String(node.fontFamily||'Inter').split(',').map(s=>s.replace(/[\"']/g,'').trim()).filter(Boolean);
 const weight=Number(node.weight)||400;
 const required=weight>=700?'Bold':weight>=600?'Semi Bold':weight>=500?'Medium':'Regular';
 const sameStyle=(font,style)=>font.fontName.style.toLowerCase().replace(/[^a-z]/g,'')===style.toLowerCase().replace(/[^a-z]/g,'');
 let found;
 for(const family of families){
  const choices=availableFonts.filter(f=>f.fontName.family.toLowerCase()===family.toLowerCase());
  found=choices.find(f=>sameStyle(f,required))||choices.find(f=>sameStyle(f,'Regular'))||choices[0];
  if(found)break;
 }
 found=found||availableFonts.find(f=>f.fontName.family==='Inter'&&sameStyle(f,required))||availableFonts.find(f=>f.fontName.family==='Inter'&&sameStyle(f,'Regular'));
 const font=found?.fontName||{family:'Inter',style:'Regular'};
 const key=font.family+'|'+font.style;
 if(!fontCache.has(key))fontCache.set(key,figma.loadFontAsync(font).then(()=>font).catch(async()=>{const fallback={family:'Inter',style:'Regular'};await figma.loadFontAsync(fallback);return fallback;}));
 return fontCache.get(key);
}
const valid=n=>n&&[n.x,n.y,n.w,n.h].every(Number.isFinite)&&n.w>0&&n.h>0;
const dim=(v,maximum=28000)=>Math.max(1,Math.min(maximum,v||1));
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
async function fetchLocal(path){
 try{
  const response=await fetch('http://localhost:4837'+path,{cache:'no-store'});
  if(!response.ok)throw Error(`Local app returned ${response.status}`);
  return response;
 }catch(error){
  throw Error('Cannot reach Layerly at localhost:4837. Keep Start-Layerly running, or choose a downloaded .layerly file. '+(error?.message||''));
 }
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
figma.ui.onmessage=async msg=>{
 if(msg.type==='check-connection'){
  try{const response=await fetchLocal('/api/status');const status=await response.json();figma.ui.postMessage({type:'connection',connected:true,hasCapture:!!status.hasCapture,version:status.version});}
  catch(e){figma.ui.postMessage({type:'connection',connected:false,message:e.message||String(e)});}
  return;
 }
 if(msg.type==='capture-url'){
  try{
   let url=String(msg.url||'').trim();
   if(!url)throw Error('Paste a public website URL first.');
   if(!/^https?:\/\//i.test(url))url='https://'+url;
   figma.ui.postMessage({type:'progress',message:'Starting the local capture engine…'});
   const started=await fetch('http://localhost:4837/api/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,options:msg.options||{},viewport:msg.viewport||{width:1440,height:900}})});
   const accepted=await started.json().catch(()=>({}));
   if(!started.ok)throw Error(accepted.error||`Local capture returned ${started.status}`);
   const deadline=Date.now()+300000;
   while(Date.now()<deadline){
    await wait(900);
    const statusResponse=await fetchLocal('/api/status');
    const status=await statusResponse.json();
    figma.ui.postMessage({type:'progress',message:status.message||'Rendering the website…'});
    if(status.state==='error')throw Error(status.message||'Capture failed');
    if(status.state==='complete')break;
   }
   if(Date.now()>=deadline)throw Error('Capture exceeded five minutes. Try a smaller viewport or disable high-res images.');
   const latest=await fetchLocal('/api/latest');
   msg={type:'import-capture',capture:await latest.json()};
  }catch(e){
   const raw=e.message||String(e);
   const friendly=/failed to fetch|networkerror/i.test(raw)?'Cannot reach the Layerly engine at localhost:4837. Start Layerly, keep its Terminal window open, and try again.':raw;
   figma.ui.postMessage({type:'error',message:friendly});return;
  }
 }
 if(msg.type==='load-latest'){
  try{const response=await fetchLocal('/api/latest');const capture=await response.json();msg={type:'import-capture',capture};}
  catch(e){figma.ui.postMessage({type:'error',message:e.message||String(e)});return;}
 }
 if(msg.type!=='import-capture')return;
 try{
  const data=msg.capture;
  if(data?.format!=='layerly.capture'||!Array.isArray(data.tree))throw Error('Invalid Layerly capture. Convert a website using the Layerly local app first.');
  const opts=data.options||{},elements=data.tree.slice(0,3500),records=new Map(),assets=data.images||{},svgAssets=data.svgAssets||{},imageCache=new Map();
  const childrenByParent=new Map();for(const child of elements){if(!childrenByParent.has(child.parentId))childrenByParent.set(child.parentId,[]);childrenByParent.get(child.parentId).push(child);}
  const root=figma.createFrame();root.name='Website / '+String(data.title||data.sourceUrl||'Imported').slice(0,120);root.resize(dim(data.page?.width,6000),dim(data.page?.height));root.fills=[{type:'SOLID',color:{r:1,g:1,b:1}}];root.clipsContent=false;root.x=0;root.y=0;
  try{root.setPluginData('layerly.sourceUrl',String(data.sourceUrl||''));root.setPluginData('layerly.capturedAt',String(data.capturedAt||''));root.setPluginData('layerly.version',String(data.version||''));}catch(_){}
  try{availableFonts=await figma.listAvailableFontsAsync();}catch(_){availableFonts=[];}
  let localStyles=[];try{if(opts.localStyles)localStyles=await figma.getLocalPaintStylesAsync();}catch(_){}
  const createdStyles=[],styleByColor=new Map();
  if(opts.stylesVariables){
   for(const [color,count] of Object.entries(data.colors||{}).sort((a,b)=>b[1]-a[1]).slice(0,24)){
    const fills=paint(color);if(!fills.length)continue;
    try{const s=figma.createPaintStyle();s.name=`Layerly / Colors / ${String(createdStyles.length+1).padStart(2,'0')}`;s.paints=fills;createdStyles.push(s);styleByColor.set(color,s.id);}catch(_){}
   }
  }
  function setFill(node,color){
   let fills=paint(color);try{node.fills=fills;}catch(_){}
   if(!fills.length)return;
   if(opts.localStyles){const same=localStyles.find(s=>JSON.stringify(s.paints)===JSON.stringify(fills));if(same){try{node.fillStyleId=same.id;return;}catch(_){}}}
   if(styleByColor.has(color)){try{node.fillStyleId=styleByColor.get(color);}catch(_){}}
  }
  const onLayer=new Map();let imported=0,skipped=0,imageCount=0,layoutCount=0,layoutRejected=0,componentCount=0,textAdjusted=0;
  const notes=[];
  for(let i=0;i<elements.length;i++){
   const n=elements[i];if(!valid(n)){skipped++;continue;}
   const parentRecord=records.get(n.parentId);
   const parent=parentRecord?.item||root;
   const origin=parentRecord?.data||{x:0,y:0};
   let item=null;
   try{
    if(n.kind==='frame'){
      item=figma.createFrame();item.resize(dim(n.w,15000),dim(n.h));item.clipsContent=['hidden','clip'].includes(n.overflow);setFill(item,n.fill);
      if(n.border?.width>0){item.strokes=paint(n.border.color);item.strokeWeight=clamp(n.border.width,.1,80);}
      if(n.radius>0)item.cornerRadius=clamp(n.radius,0,Math.min(n.w,n.h)/2);
      if(n.shadow){try{item.effects=effect(n.shadow);}catch(_){}}
    } else if(n.kind==='text'){
      item=figma.createText();item.fontName=await getFont(n);
      let characters=String(n.text||'').slice(0,3000);
      if(n.textTransform==='uppercase')characters=characters.toLocaleUpperCase();
      if(n.textTransform==='lowercase')characters=characters.toLocaleLowerCase();
      item.characters=characters;
      item.fontSize=clamp(n.fontSize||16,6,360);
      setFill(item,n.color||'#000000');
      const line=parseFloat(n.lineHeight);if(Number.isFinite(line)&&line>0){try{item.lineHeight={value:line,unit:'PIXELS'};}catch(_){}}
      const tracking=parseFloat(n.letterSpacing);if(Number.isFinite(tracking)){try{item.letterSpacing={value:tracking,unit:'PIXELS'};}catch(_){}}
      if(String(n.textDecoration||'').includes('underline'))item.textDecoration='UNDERLINE';
      if(String(n.textDecoration||'').includes('line-through'))item.textDecoration='STRIKETHROUGH';
      item.textAutoResize='NONE';item.resize(dim(n.w+2,15000),dim(n.h+2));
      // An editable fixed box retains the captured line breaks. Auto-height is
      // optional, and is kept only when Figma's font metrics stay close.
      if(opts.editableText===true){
       try{
        item.textAutoResize='HEIGHT';
        if(Math.abs(item.height-(n.h+2))>2){item.textAutoResize='NONE';item.resize(dim(n.w+2,15000),dim(n.h+2));textAdjusted++;}
       }catch(_){}
      }
      if(n.align==='center')item.textAlignHorizontal='CENTER';if(n.align==='right'||n.align==='end')item.textAlignHorizontal='RIGHT';
      if(n.link){try{item.setRangeHyperlink(0,item.characters.length,{type:'URL',value:n.link});}catch(_){}}
    } else if(n.kind==='image'){
      const vector=svgAssets[n.src];
      if(vector){
       item=figma.createNodeFromSvg(vector);
       if(item.width>0&&item.height>0){const scale=Math.min(n.w/item.width,n.h/item.height);if(isFinite(scale)&&scale>0&&scale<100)item.rescale(scale);}
       imageCount++;
      }else{
      item=figma.createRectangle();item.resize(dim(n.w,15000),dim(n.h));
      const uri=assets[n.src]||(String(n.src||'').startsWith('data:')?n.src:null);
      if(uri){const bytes=decodeBase64(uri);
       if(bytes){let hash=imageCache.get(n.src);if(!hash){hash=figma.createImage(bytes).hash;imageCache.set(n.src,hash);}item.fills=[{type:'IMAGE',imageHash:hash,scaleMode:n.fit==='contain'?'FIT':'FILL'}];imageCount++;}
       else{item.fills=paint('#eeeeeb');skipped++;}
      }else{item.fills=paint('#eeeeeb');skipped++;}
      }
    } else if(n.kind==='svg'){
      item=figma.createNodeFromSvg(n.svg||'');
      if(item.width>0&&item.height>0){const scale=Math.min(n.w/item.width,n.h/item.height);if(isFinite(scale)&&scale>0&&scale<100)item.rescale(scale);}
    }
    if(!item){skipped++;continue;}
    item.name=String(n.name||n.kind).slice(0,160);
    try{
      item.setPluginData('layerly.kind',String(n.kind||''));
      item.setPluginData('layerly.htmlTag',String(n.tag||''));
      if(n.src)item.setPluginData('layerly.assetUrl',String(n.src).slice(0,4090));
      if(n.link)item.setPluginData('layerly.link',String(n.link).slice(0,4090));
    }catch(_){}
    if(n.radius>0&&'cornerRadius' in item){try{item.cornerRadius=clamp(n.radius,0,Math.min(n.w,n.h)/2);}catch(_){}}
    parent.appendChild(item);
    item.x=clamp(n.x-origin.x,-30000,30000);item.y=clamp(n.y-origin.y,-30000,30000);
    if(n.opacity!=null)item.opacity=clamp(n.opacity,0,1);
    records.set(n.id,{data:n,item});
    if(n.kind==='frame')onLayer.set(n.id,item);
    imported++;
    if(i>0&&i%180===0)figma.ui.postMessage({type:'progress',message:`Creating native layers… ${i} / ${elements.length}`});
   }catch(err){skipped++;}
  }
  // Build Auto Layout only when its real output matches the browser geometry.
  // CSS gaps, intrinsic text sizing and font fallbacks can otherwise shift a
  // whole section even when its DOM looks like a simple flex row.
  if(opts.autolayout){
   for(const n of [...elements].reverse()){
     const f=onLayer.get(n.id);if(!f||!['flex','inline-flex'].includes(n.display)||!f.children||f.children.length<2)continue;
     if(!['row','column'].includes(n.flexDirection)||n.flexWrap!=='nowrap')continue;
     const children=childrenByParent.get(n.id)||[];
     if(children.length!==f.children.length||children.some(c=>['absolute','fixed','sticky'].includes(c.position)||c.tag==='background-image'))continue;
     // Figma's layout engine repositions children. Preserve the rendered layout
     // when transformed or overlapping children do not form a simple flex row.
     const axis=n.flexDirection==='row'?'x':'y',size=axis==='x'?'w':'h';
     const positions=children.map(c=>({start:c[axis],end:c[axis]+c[size]}));
     if(positions.some((p,i)=>i>0&&p.start<positions[i-1].end-2))continue;
     if(children.some(c=>c.x<n.x-4||c.y<n.y-4||c.x+c.w>n.x+n.w+4||c.y+c.h>n.y+n.h+4))continue;
     const before=f.children.map(item=>({item,x:item.x,y:item.y,w:item.width,h:item.height}));
     const parentBefore={w:f.width,h:f.height};
     try{
       f.layoutMode=n.flexDirection==='row'?'HORIZONTAL':'VERTICAL';
       f.primaryAxisSizingMode='FIXED';f.counterAxisSizingMode='FIXED';
       f.itemSpacing=clamp(n.gap||0,0,500);
       f.paddingTop=clamp(n.padding?.top||0,0,1000);
       f.paddingBottom=clamp(n.padding?.bottom||0,0,1000);
       f.paddingLeft=clamp(n.padding?.left||0,0,1000);
       f.paddingRight=clamp(n.padding?.right||0,0,1000);
       const align={'flex-start':'MIN','start':'MIN','center':'CENTER','flex-end':'MAX','end':'MAX'};
       f.counterAxisAlignItems=align[n.align]||'MIN';
       f.primaryAxisAlignItems=n.justify==='space-between'?'SPACE_BETWEEN':align[n.justify]||'MIN';
       for(const childData of children){
         const childItem=records.get(childData.id)?.item;if(!childItem)continue;
         try{if(Number(childData.flexGrow)>0)childItem.layoutGrow=1;}catch(_){}
         try{if(childData.alignSelf==='stretch')childItem.layoutAlign='STRETCH';}catch(_){}
       }
       const drift=before.some(({item,x,y,w,h})=>
         Math.abs(item.x-x)>2||Math.abs(item.y-y)>2||
         Math.abs(item.width-w)>2||Math.abs(item.height-h)>2);
       if(drift||Math.abs(f.width-parentBefore.w)>2||Math.abs(f.height-parentBefore.h)>2){
         f.layoutMode='NONE';
         for(const saved of before){
           try{saved.item.layoutGrow=0;saved.item.layoutAlign='INHERIT';}catch(_){}
           try{
             if(Math.abs(saved.item.width-saved.w)>0.1||Math.abs(saved.item.height-saved.h)>0.1){
               if(saved.item.type==='TEXT'&&saved.item.textAutoResize==='HEIGHT')saved.item.textAutoResize='NONE';
               saved.item.resize(saved.w,saved.h);
             }
           }catch(_){}
           saved.item.x=saved.x;saved.item.y=saved.y;
         }
         if(Math.abs(f.width-parentBefore.w)>0.1||Math.abs(f.height-parentBefore.h)>0.1)f.resize(parentBefore.w,parentBefore.h);
         layoutRejected++;
       }else layoutCount++;
     }catch(err){
       try{f.layoutMode='NONE';for(const saved of before){saved.item.x=saved.x;saved.item.y=saved.y;}}catch(_){}
       layoutRejected++;
     }
   }
  }
  // Native editable button components (not only a checkbox or metadata).
  if(opts.components){
   for(const n of elements){
    const item=onLayer.get(n.id);if(!n.isComponent||!item||item.type!=='FRAME')continue;
    try{
      const before=item.parent,x=item.x,y=item.y;
      const component=figma.createComponentFromNode(item);
      if(before&&component.parent!==before)before.appendChild(component);
      component.x=x;component.y=y;component.name='Button / '+String(n.name||'Component').slice(0,50);
      onLayer.set(n.id,component);componentCount++;
    }catch(_){}
   }
  }
  figma.currentPage.selection=[root];figma.viewport.scrollAndZoomIntoView([root]);
  if(opts.hoverEffects)notes.push(`${(data.hoverRules||[]).length} hover CSS selectors detected, but variants were not generated`);
  if(!opts.autolayout)notes.push('Auto Layout was disabled');
  if(layoutRejected)notes.push(`${layoutRejected} flex sections kept precisely positioned because Auto Layout moved their children`);
  if(textAdjusted)notes.push(`${textAdjusted} text boxes kept fixed to prevent font reflow`);
  if(skipped)notes.push(`${skipped} missing or unsupported parts`);
  figma.ui.postMessage({type:'done',count:imported,layoutCount,layoutRejected,componentCount,imageCount,styleCount:createdStyles.length,notes:notes.join(' · ')});
  figma.notify(`Layerly imported ${imported} native layers.`,{timeout:5000});
 }catch(e){figma.ui.postMessage({type:'error',message:e.message||String(e)});}
};
