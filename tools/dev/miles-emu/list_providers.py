# Lists the codecs a Miles .asi plugin registers.   python3 list_providers.py <path to mssvoice.asi>
import sys
from miles_emu import Rib
rib = Rib(sys.argv[1])
for h, p in rib.providers.items():
    if 'ASI codec' not in p:
        continue
    props = {k: rib.provider_property(h, k) for k in ('Name', 'Input file types', 'Output file types', 'Input wave tag', 'Maximum frame size')}
    print(hex(h), props)
