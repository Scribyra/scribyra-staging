// Host selects a static shell; GitLab Pages still enforces access control.
const app={"host":"dev.scribyra.com","presentationHost":"scribyra-staging-1301bb.gitlab.io","url":"https://dev.scribyra.com/","legacy":"https://dev.scribyra.com/app/","module":"/assets/index-BH33LhdL.js","styles":["/assets/index-CVsSwlmZ.css"],"body":"","title":"Scribyra — Your ideas, beautifully written"};
if(location.hostname===app.host){
 document.title=app.title;
 const recipe=document.createElement('link');recipe.rel='alternate';recipe.type='text/markdown';recipe.href='agent.md';document.head.append(recipe);
 for(const node of document.querySelectorAll('link[rel="stylesheet"]'))node.remove();
 document.body.innerHTML=app.body;
 try{
  const load=(tag,attributes)=>new Promise((resolve,reject)=>{const node=document.createElement(tag);Object.assign(node,attributes);node.onload=resolve;node.onerror=()=>reject(Error('App asset unavailable'));document.head.append(node);});
  await Promise.all([...app.styles.map(href=>load('link',{rel:'stylesheet',href,crossOrigin:'anonymous'})),load('script',{type:'module',src:app.module,crossOrigin:'anonymous'})]);
 }catch{
  const message=document.createElement('p');message.textContent='Scribyra could not load. Reconnect and reload.';
  const previous=document.createElement('a');previous.textContent='Open the previous app address';previous.href=app.legacy;
  document.body.replaceChildren(message,previous);
 }finally{delete document.documentElement.dataset.scribyraApp;}
}else{
 if(location.hostname===app.presentationHost)for(const link of document.querySelectorAll('a[href="app/"]'))link.href=app.url;
 await import('./site.js');
}
