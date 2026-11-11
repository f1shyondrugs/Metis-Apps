// Version 1 monitor-relative overlay protocol. Pure data; never executes content.
const LIMIT = 1024 * 1024, MAX_ITEMS = 100;
const TYPES = new Set(['rect','ellipse','line','arrow','path','highlight','text','spotlight','card']);
const OPS = new Set(['status','add','replace','update','remove','clear','undo','interact']);
const clone = value => JSON.parse(JSON.stringify(value));
function record(v, label) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype,null].includes(Object.getPrototypeOf(v))) throw Error('Invalid '+label);
  for(const k of Object.keys(v)) if(['__proto__','prototype','constructor'].includes(k)) throw Error('Invalid object key');
  return v;
}
function text(v, label, max=100000) { if(typeof v!=='string'||v.length>max)throw Error('Invalid '+label);return v; }
function identifier(v) { if(typeof v!=='string'||['__proto__','constructor','prototype'].includes(v)||!/^[-a-zA-Z0-9_:.]{1,100}$/.test(v))throw Error('Invalid overlay ID');return v; }
function number(v, lo, hi, label) { if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi)throw Error('Invalid '+label);return v; }
function paint(v) { if(typeof v!=='string'||!(/^(#[a-fA-F0-9]{3,8}|transparent|currentColor)$/.test(v)))throw Error('Invalid overlay color');return v; }
function box(v, d) { return {x:number(v.x,0,d.width,'x'),y:number(v.y,0,d.height,'y'),width:number(v.width,1,d.width,'width'),height:number(v.height,1,d.height,'height')}; }
function validateItem(input,d) {
  record(input,'overlay item');const v=clone(input);
  const allowed=new Set(['id','type','group','x','y','width','height','color','fill','opacity','strokeWidth','radius','text','fontSize','points','doubleArrow','holes','content','ttlMs']);
  if(Object.keys(v).some(k=>!allowed.has(k)))throw Error('Unknown overlay item property');
  const item={id:identifier(v.id),type:v.type,...box(v,d)};
  if(item.x+item.width>d.width||item.y+item.height>d.height)throw Error('Overlay lies outside selected monitor');
  if(!TYPES.has(v.type))throw Error('Invalid overlay type');
  if(v.group!==undefined)item.group=identifier(v.group);
  for(const k of ['color','fill'])if(v[k]!==undefined)item[k]=paint(v[k]);
  for(const [k,lo,hi] of [['opacity',0,1],['strokeWidth',1,24],['radius',0,200],['fontSize',10,160],['ttlMs',0,3600000]])if(v[k]!==undefined)item[k]=number(v[k],lo,hi,k);
  if(v.text!==undefined)item.text=text(v.text,'text');
  if(v.doubleArrow!==undefined){if(typeof v.doubleArrow!=='boolean')throw Error('Invalid doubleArrow');item.doubleArrow=v.doubleArrow;}
  if(['line','arrow','path'].includes(item.type)){
    if(v.points===undefined&&item.type!=='path')v.points=[{x:item.x,y:item.y},{x:item.x+item.width,y:item.y+item.height}];
    if(!Array.isArray(v.points)||v.points.length<2||v.points.length>1024)throw Error('Invalid overlay points');
    item.points=v.points.map(p=>{record(p,'point');return {x:number(p.x,0,d.width,'point x'),y:number(p.y,0,d.height,'point y')};});
  }
  if(item.type==='spotlight'){
    if(!Array.isArray(v.holes)||v.holes.length>16)throw Error('Invalid spotlight holes');
    item.holes=v.holes.map(h=>{record(h,'hole');if(!['rect','ellipse'].includes(h.shape))throw Error('Invalid spotlight hole');const b=box(h,d);if(b.x+b.width>d.width||b.y+b.height>d.height)throw Error('Spotlight hole outside monitor');return {...b,shape:h.shape,radius:h.radius===undefined?0:number(h.radius,0,200,'hole radius')};});
  }
  if(item.type==='text' && typeof item.text!=='string')throw Error('Text annotation requires text');
  if(item.type==='card'){
    record(v.content,'card content');
    const c=v.content;if(!['markdown','html','graph','chart','file'].includes(c.kind))throw Error('Invalid overlay content kind');
    item.content={kind:c.kind};
    if(c.imageFit!==undefined){if(c.kind!=='file'||!['contain','cover'].includes(c.imageFit))throw Error('Invalid image fit');item.content.imageFit=c.imageFit;}
    if(c.imagePosition!==undefined){record(c.imagePosition,'image position');item.content.imagePosition={x:number(c.imagePosition.x,0,100,'image x'),y:number(c.imagePosition.y,0,100,'image y')};}
    if(['markdown','html'].includes(c.kind))item.content.source=text(c.source,'content source');
    if(['graph','chart'].includes(c.kind)){record(c.spec,'content specification');if(JSON.stringify(c.spec).length>100000)throw Error('Content specification too large');item.content.spec=clone(c.spec);}
    if(c.kind==='file'){
      const f=record(c.file,'file');const url=text(f.url,'file URL',2000);
      // Only the authenticated account-scoped upload handlers, no external URLs or local paths.
      if(!/^\/api\/(?:file-uploads\/[a-zA-Z0-9_-]+\/file|uploads\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.%()!~*'-]+)$/.test(url)||url.includes('..')||/[\\\\/]/.test(decodeURIComponent(url.split('/').at(-1))))throw Error('Unsupported overlay file URL');
      item.content.file={...(f.id===undefined?{}:{id:identifier(f.id)}),url,name:text(f.name,'file name',250),mimeType:text(f.mimeType,'file type',120)};
      if(f.size!==undefined)item.content.file.size=number(f.size,0,64*1024*1024,'file size');
    }
  }
  return item;
}
function createOverlayScene({now=Date.now}={}) {
  const scenes=new Map();let revision=0;
  function get(id) {const scene=scenes.get(String(id));if(!scene)throw Error('Select an actual connected display_id from status');return scene;}
  function snapshot(s){return {items:clone(s.items),expires:{...s.expires}};}
  function prune(s){const gone=new Set(Object.keys(s.expires).filter(id=>s.expires[id]<=now()));if(gone.size){s.items=s.items.filter(x=>!gone.has(x.id));for(const id of gone)delete s.expires[id];if(gone.has(s.interactiveId))s.interactiveId=null;s.revision=++revision;} }
  function state(id){const s=get(id);prune(s);return {revision:s.revision,items:clone(s.items),display:{...s.display},interactiveId:s.interactiveId};}
  function remember(s){s.history.push(snapshot(s));if(s.history.length>10)s.history.shift();}
  return {
    sync(displays){
      const ids=new Set(displays.map(d=>String(d.id)));for(const id of scenes.keys())if(!ids.has(id))scenes.delete(id);
      for(const d of displays){const id=String(d.id),display={id,width:d.bounds.width,height:d.bounds.height};const old=scenes.get(id);
        if(!old||old.display.width!==display.width||old.display.height!==display.height)scenes.set(id,{display,items:[],expires:{},history:[],interactiveId:null,revision:++revision});
      }
    },
    state,
    peek(id){const s=get(id);prune(s);return s;},
    hasItems(){return [...scenes.values()].some(s=>{prune(s);return s.items.length;});},
    reset(){for(const s of scenes.values()){s.items=[];s.expires={};s.history=[];s.interactiveId=null;s.revision=++revision;}},
    states(){return [...scenes.keys()].map(state);},
    checkpoint(){return clone([...scenes]);},
    restore(value){scenes.clear();for(const [id,s] of value){s.revision=++revision;scenes.set(id,s);} },
    apply(params){
      record(params,'overlay command');if(Buffer.byteLength(JSON.stringify(params),'utf8')>LIMIT)throw Error('Overlay command exceeds 1 MiB');
      const operation=params.operation;if(!OPS.has(operation))throw Error('Invalid overlay operation');
      if(operation==='status')return;
      if(operation==='clear'&&params.all===true){for(const s of scenes.values()){remember(s);s.items=[];s.expires={};s.interactiveId=null;s.revision=++revision;}return;}
      const s=get(params.display_id);prune(s);
      if(operation==='interact'){
        const id=params.interactive_id;if(id!==null && (!s.items.some(x=>x.id===id&&x.type==='card')))throw Error('Select a card ID for interaction, or null for click-through');
        s.interactiveId=id;s.revision=++revision;return;
      }
      if(operation==='undo'){
        const previous=s.history.pop();if(previous){s.items=previous.items;s.expires=previous.expires;s.interactiveId=null;s.revision=++revision;prune(s);}return;
      }
      if(operation==='clear'){remember(s);s.items=[];s.expires={};s.interactiveId=null;s.revision=++revision;return;}
      if(operation==='remove'){
        if((!Array.isArray(params.ids)||!params.ids.length)&&!params.group)throw Error('Specify ids or group to remove');
        const ids=new Set((params.ids||[]).map(identifier));const group=params.group===undefined?undefined:identifier(params.group);
        remember(s);s.items=s.items.filter(x=>!ids.has(x.id)&&(!group||x.group!==group));const remaining=new Set(s.items.map(x=>x.id));for(const id of Object.keys(s.expires))if(!remaining.has(id))delete s.expires[id];
      }else{
        if(!Array.isArray(params.items)||(operation!=='replace'&&!params.items.length)||params.items.length>MAX_ITEMS)throw Error('Specify 1–100 overlay items');
        const values=params.items.map(x=>validateItem(x,s.display));const incoming=new Set(values.map(x=>x.id));if(incoming.size!==values.length)throw Error('Duplicate annotation ID');
        const existing=new Set(s.items.map(x=>x.id));
        if(operation==='add'&&values.some(x=>existing.has(x.id)))throw Error('Annotation ID already exists; use update');
        if(operation==='update'&&values.some(x=>!existing.has(x.id)))throw Error('Cannot update an unknown annotation');
        const next=operation==='replace'?values:operation==='update'?s.items.map(x=>values.find(y=>y.id===x.id)||x):[...s.items,...values];
        if(next.length>MAX_ITEMS||Buffer.byteLength(JSON.stringify(next),'utf8')>LIMIT)throw Error('Overlay scene exceeds limits');
        remember(s);s.items=next;if(operation==='replace')s.expires={};
        for(const item of values){delete s.expires[item.id];if(item.ttlMs)s.expires[item.id]=now()+item.ttlMs;}
      }
      if(!s.items.some(x=>x.id===s.interactiveId))s.interactiveId=null;
      s.revision=++revision;
    }
  };
}
module.exports={createOverlayScene,validateItem,MAX_ITEMS,LIMIT};
