import { useEffect, useState } from 'react';
import logoPng from '../assets/logo.png';

export default function LoginTransition({ onComplete }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 50);
    const t2 = setTimeout(() => onComplete(), 1300);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onComplete]);

  return (
    <div className={`login-transition${visible ? ' visible' : ''}`}>
      <img src={logoPng} alt="Shelfio" className="lt-logo" />
    </div>
  );
}


