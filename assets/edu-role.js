document.querySelectorAll('[data-print]').forEach(b=>b.addEventListener('click',()=>window.print()));
document.querySelectorAll('[data-filter]').forEach(input=>input.addEventListener('input',e=>{
 const q=e.target.value.toLowerCase(); const rows=document.querySelectorAll('tbody tr');
 rows.forEach(r=>r.style.display=r.innerText.toLowerCase().includes(q)?'':'none');
}));
