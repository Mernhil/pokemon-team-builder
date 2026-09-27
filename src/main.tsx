import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// While a slider is being dragged, dragging past its ends must not select the surrounding text.
// A class + selectstart guard works in every engine (the desktop webviews included).
const root = document.documentElement;
document.addEventListener('pointerdown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'range') {
    root.classList.add('slider-dragging');
    window.getSelection()?.removeAllRanges();
  }
});
const endDrag = () => root.classList.remove('slider-dragging');
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
window.addEventListener('blur', endDrag);
document.addEventListener('selectstart', (e) => root.classList.contains('slider-dragging') && e.preventDefault());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
