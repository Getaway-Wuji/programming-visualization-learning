import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const original = readFileSync('.artifacts/16.2/inspect-visible-source.mjs', 'utf8');
const start = original.indexOf('    // QA setup only;');
const end = original.indexOf('    const fold =', start);
if (start < 0 || end < 0) throw Error('Expected original inspector QA boundary');
const setup = `    // QA setup only; original skill probes and judgment rules remain unchanged.
    await page.eval(async () => {
      const wait=async(test)=>{const end=performance.now()+15000;while(!test()){if(performance.now()>end)throw Error('Actual snapshot UI setup timed out');await new Promise(r=>setTimeout(r,50));}};
      await wait(()=>document.querySelector('[data-testid="memory-workspace"]'));
      [...document.querySelectorAll('button')].find(b=>b.textContent==='运行样例').click();
      await wait(()=>document.querySelector('[data-testid="memory-workspace"]')?.getAttribute('data-state')==='ready');
      const slider=document.querySelector('input[aria-label="执行步骤"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,'25');
      slider.dispatchEvent(new Event('input',{bubbles:true}));
      slider.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(()=>document.querySelector('[data-testid="memory-workspace"]')?.getAttribute('data-cursor')==='25');
      document.querySelector('.snapshot-export summary').click();
      window.scrollTo({top:0,behavior:'instant'});
    });
`;
writeFileSync('.artifacts/16.3/inspect-snapshot.mjs', original.slice(0, start) + setup + original.slice(end), {flag:'wx'});
mkdirSync('.artifacts/16.3/taste', { recursive:true });
writeFileSync('.artifacts/16.3/taste/direction.json', readFileSync('.artifacts/16.2/taste/direction.json'), {flag:'wx'});
writeFileSync('.artifacts/16.3/taste/brief.txt', '16.3 extends the accepted framed-sheet teaching workspace. Keep minimal palette, typography, navigation and all source/pointer/stack affordances. One job: save the exact paused state to the user device. A quiet export strip follows the real view and controls, with equal JSON/PNG actions and immediate scope/privacy text. Screenshots use real nodes execution at cursor25 and expanded file scope; PNG is a separate 1440px reflowed complete-state document, with code on the left and state on the right, no fake data. No new style direction, navigation, framework or dependency.\n', {flag:'wx'});
