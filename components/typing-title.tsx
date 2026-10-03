'use client';
import { useEffect, useState } from 'react';

const TITLES = [
  ['早上好，开始一份新报价', '开始新报价'],
  ['每一笔，算得清楚。', '快速计价'],
  ['研发清单，快速算清。', '研发计价'],
  ['选好商品，即刻报价。', '即刻报价'],
  ['数量一改，价格即来。', '随量计价'],
  ['一份清单，轻松算完。', '轻松算完'],
  ['多种规格，一起算清。', '规格齐全'],
  ['让每次报价更简单。', '简单报价'],
  ['从选品到报价，一步。', '选品即算'],
  ['单价总价，一目了然。', '价格清晰'],
  ['随手一选，心中有数。', '心中有数'],
  ['报价有据，沟通省心。', '报价省心'],
  ['清单随行，报价随心。', '随时报价'],
  ['少些计算，多些从容。', '从容计价'],
] as const;

export function TypingTitle({ text }: { text: string }) {
  const compact = text === '快速计价';
  const [display, setDisplay] = useState(text);
  const [phase, setPhase] = useState('static');
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setTimeout>;
    let previous = -1;
    const later = (fn: () => void, delay: number) => { timer = setTimeout(fn, delay); };
    const begin = () => {
      let next = Math.floor(Math.random() * (TITLES.length - (previous < 0 ? 0 : 1)));
      if (previous >= 0 && next >= previous) next++;
      previous = next;
      const title = Array.from(TITLES[next][compact ? 1 : 0]);
      let count = 0;
      setDisplay(''); setPhase('typing');
      const type = () => {
        setDisplay(title.slice(0, ++count).join(''));
        if (count < title.length) later(type, 130);
        else {
          setPhase('holding');
          later(begin, 3000);
        }
      };
      later(type, 200);
    };
    const sync = () => {
      clearTimeout(timer);
      if (motion.matches || document.hidden) { setDisplay(text); setPhase('static'); }
      else begin();
    };
    sync();
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => { clearTimeout(timer); motion.removeEventListener('change', sync); document.removeEventListener('visibilitychange', sync); };
  }, [compact, text]);
  return <span className="typing-title">
    <span className="sr-only">{text}</span>
    <span className="typing-space" aria-hidden="true">{compact ? '快速计价' : '早上好，开始一份新报价'}</span>
    <span className={`typing-output is-${phase}`} aria-hidden="true">{display}<span className="typing-cursor" /></span>
  </span>;
}
