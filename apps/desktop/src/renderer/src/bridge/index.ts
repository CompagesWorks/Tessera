import { tesseraBridge } from './tessera';
import { createWindowControls, enableDragRegions } from './window-controls';

Object.defineProperty(window, 'tessera', { value: Object.freeze(tesseraBridge), writable: false, configurable: false });
Object.defineProperty(window, 'atriumWindow', { value: Object.freeze(createWindowControls()), writable: false, configurable: false });
enableDragRegions();
if (/Macintosh|Mac OS X/.test(navigator.userAgent)) document.documentElement.dataset.platform = 'mac';
