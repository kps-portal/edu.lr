(function(){
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const toast=(msg,type='info')=>{let t=$('.deo-toast'); if(!t){t=document.createElement('div');t.className='deo-toast';document.body.appendChild(t)} t.className='deo-toast '+type;t.textContent=msg;t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),3200)};
  $$('[data-toast]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();toast(b.dataset.toast,b.dataset.toastType||'info')}));
  $$('[data-print]').forEach(b=>b.addEventListener('click',()=>window.print()));
  const search=$('[data-global-search]'); if(search){search.addEventListener('input',()=>{const q=search.value.toLowerCase();$$('[data-search-item]').forEach(x=>x.style.display=x.textContent.toLowerCase().includes(q)?'':'none')})}
  const clock=$('[data-live-clock]'); if(clock){const tick=()=>clock.textContent=new Intl.DateTimeFormat('en-LR',{dateStyle:'medium',timeStyle:'medium'}).format(new Date());tick();setInterval(tick,1000)}
  $$('[data-expand]').forEach(b=>b.addEventListener('click',()=>{const x=$(b.dataset.expand);if(x)x.classList.toggle('expanded')}));
  $$('form[data-demo-form]').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();toast(f.dataset.success||'Saved securely for review.','good');f.reset()}));
  // active nav based on current file
  const file=location.pathname.split('/').pop()||'dashboard.html'; $$('.nav a').forEach(a=>{if(a.getAttribute('href')===file)a.classList.add('active')});
})();
