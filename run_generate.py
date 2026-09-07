import sys
from pathlib import Path
sys.path.append('scripts')
import dump_anilist

dump_anilist.generate_indexes(Path('data/raw/anime'))
