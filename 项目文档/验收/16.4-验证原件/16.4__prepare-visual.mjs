import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
const original=readFileSync('.artifacts/16.3/inspect-snapshot.mjs','utf8'),start=original.indexOf('    // QA setup only;'),end=original.indexOf('    const fold =',start);
if(start<0||end<0)throw Error('Expected original unmodified inspector QA boundary');
const setup=`    // QA setup only; original skill probes and judgment rules remain unchanged.
    await page.eval(async () => {
      const wait=async(test)=>{const end=performance.now()+15000;while(!test()){if(performance.now()>end)throw Error('Actual C++ sort UI setup timed out');await new Promise(r=>setTimeout(r,50));}};
      await wait(()=>document.querySelector('[data-testid="sort-workspace"]'));
      [...document.querySelectorAll('button')].find(b=>b.textContent==='运行C++案例').click();
      await wait(()=>document.querySelector('[data-testid="sort-workspace"]')?.getAttribute('data-state')==='ready');
      const slider=document.querySelector('input[aria-label="C++排序执行步骤"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,'100');
      slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(()=>document.querySelector('[data-testid="sort-workspace"]')?.getAttribute('data-cursor')==='100');
      window.scrollTo({top:0,behavior:'instant'});
    });
`;
writeFileSync('.artifacts/16.4/inspect-sorts.mjs',original.slice(0,start)+setup+original.slice(end),{flag:'wx'});
mkdirSync('.artifacts/16.4/taste',{recursive:true});
writeFileSync('.artifacts/16.4/taste/direction.json',readFileSync('.artifacts/16.3/taste/direction.json'),{flag:'wx'});
writeFileSync('.artifacts/16.4/taste/brief.txt',`16.4 extends the existing framed-sheet learning workbench, keeping minimal palette, type and shell.
Question: What did the actual C++ sort change at this paused step?
Objects: values[30] with logical n=0..30; scalar key/j/gap; counting counts[41] with keys -20..20; current output and counters.
Data comes only from accepted Rust Step DSL and one player; no front-end sorting or invented reads/swaps.
People: beginning learners at a desktop, also a 390px browser; run, pause, step, rewind and compare source location.
Primary job: execute the chosen sample, then inspect and reverse its state.
Product face: retain 一步一懂 mark and existing blue on actual values; exact real write borders and signed scale are the signature, not decorative illustrations.
Compose input above shared workbench, code left, current teaching phase/real counters/array right, then compact method details.
Zero is visible; absent/uninitialized objects are explicit; n is distinct from capacity30; bucket frequencies decrease during actual reconstruction.
Default7 values; 0/1/30 and limited domains are real checked cases. Test Chrome/minimal1440/768/390 using actual counting run at cursor100.
No reward/saving or global navigation expansion. No new style draw; component extension of accepted seed1060963509.
`,{flag:'wx'});
writeFileSync('.artifacts/16.4/visual.mjs',readFileSync('.artifacts/16.3/visual.mjs','utf8').replaceAll('16.3','16.4').replaceAll('inspect-snapshot.mjs','inspect-sorts.mjs').replace('http://127.0.0.1:4178/#/memory?example=nodes&view=memory','http://127.0.0.1:4178/#/algorithms/case.cpp.counting-sort'),{flag:'wx'});
