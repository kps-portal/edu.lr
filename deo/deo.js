
document.addEventListener('DOMContentLoaded',()=>{
 document.querySelectorAll('[data-filter]').forEach(input=>{
   input.addEventListener('input',()=>{
    const q=input.value.toLowerCase();
    const table=document.querySelector(input.dataset.filter);
    if(!table)return;
    table.querySelectorAll('tbody tr').forEach(r=>r.style.display=r.innerText.toLowerCase().includes(q)?'':'none');
   });
 });
 document.querySelectorAll('[data-print]').forEach(b=>b.addEventListener('click',()=>window.print()));
 document.querySelectorAll('[data-export]').forEach(b=>b.addEventListener('click',()=>{
   const target=document.querySelector(b.dataset.export); if(!target)return;
   const rows=[...target.querySelectorAll('tr')].map(r=>[...r.children].map(c=>`"${c.innerText.replaceAll('"','""')}"`).join(',')).join('\n');
   const blob=new Blob([rows],{type:'text/csv'}), a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='deo-report.csv';a.click();URL.revokeObjectURL(a.href);
 }));
});
