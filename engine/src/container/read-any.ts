// Reads any supported demo into the protocol-48 model the rest of the engine understands. Demo format 5 (1.1+,
// protocols 41-48) is read as it is; 1999 demos (format 4, protocols 39-40, plan F4) are converted in memory first, so
// the inspector, match data and details work on them unchanged. `source*` keep what the file itself is.
import { readDemo } from './read.js';
import type { DemoFile } from './types.js';
import { isFormat4, readHeader4 } from '../legacy/format4.js';
import { convert1999 } from '../legacy/convert-1999.js';

export interface AnyDemo {
  demo: DemoFile;
  /** The file's own network protocol (40 for a 1999 demo read through the converter). */
  sourceProtocol: number;
  /** The file's own demo format (4 or 5). */
  sourceDemoProtocol: number;
}

export function readAnyDemo(bytes: Uint8Array): AnyDemo {
  if (isFormat4(bytes)) {
    const h = readHeader4(bytes);
    const { demo, report } = convert1999(bytes);
    // Frames that could not be read are the only conversion warnings that are problems with the file itself.
    demo.problems.push(...report.warnings.filter((w) => w.includes('could not be read') || w.includes('frame starting at byte')));
    return { demo, sourceProtocol: h.networkProtocol, sourceDemoProtocol: 4 };
  }
  const demo = readDemo(bytes);
  return { demo, sourceProtocol: demo.header.networkProtocol, sourceDemoProtocol: demo.header.demoProtocol };
}
