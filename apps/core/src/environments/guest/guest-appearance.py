#!/usr/bin/env python3
"""Apply APX's resolved appearance without replacing a custom owner wallpaper."""
from pathlib import Path
import configparser
import os
import pwd
import re
import shutil
import subprocess
import sys
import time
from apx_vm_session import desktop_environment

home = Path(pwd.getpwuid(os.getuid()).pw_dir)
assets = home / '.local/share/apx-vm'
marker = home / '.config/apx-vm/appearance-version'
mode_file = home / '.config/apx-vm/appearance-mode'
mode = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in ('light', 'dark') else 'light'
reset = '--reset' in sys.argv
for variant in ('light', 'dark'):
    theme = home / f'.themes/APX-Green-{variant}'
    (theme / 'gtk-3.0').mkdir(parents=True, exist_ok=True)
    css = f'{variant}.gtk'
    shutil.copy2(assets / 'gtk-3.0' / css, theme / 'gtk-3.0/gtk.css')
    frames = theme / 'xfwm4'
    frames.mkdir(exist_ok=True)
    # Reuse Xfce's installed artwork with its original license.
    for source in Path('/usr/share/themes/Default/xfwm4').iterdir():
        if source.suffix == '.xpm' or source.name == 'README':
            shutil.copy2(source, frames / source.name)
    frame = 'themerc-light' if variant == 'light' else 'themerc'
    shutil.copy2(assets / 'xfwm4' / frame, frames / 'themerc')
for attempt in range(40):
    try:
        environment = desktop_environment()
        break
    except RuntimeError:
        if attempt == 39:
            raise
        time.sleep(0.25)

if marker.exists() and marker.read_text().strip() == '3' and mode_file.exists() and mode_file.read_text().strip() == mode and not reset:
    print('APX appearance unchanged; owner preferences preserved')
    sys.exit(0)

def query(channel, prop, optional=False):
    result = subprocess.run(['xfconf-query', '-c', channel, '-p', prop], env=environment,
                            check=not optional, capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else ''

def setting(channel, prop, kind, value):
    subprocess.run(['xfconf-query', '-c', channel, '-p', prop, '-n', '-t', kind, '-s', str(value)],
                   env=environment, check=True)

name = f'APX-Green-{mode}'
setting('xsettings', '/Net/ThemeName', 'string', name)
setting('xsettings', '/Net/IconThemeName', 'string', 'Adwaita')
setting('xsettings', '/Gtk/FontName', 'string', 'DejaVu Sans 10')
setting('xsettings', '/Gtk/MonospaceFontName', 'string', 'DejaVu Sans Mono 10')
setting('xfwm4', '/general/theme', 'string', name)
setting('xfwm4', '/general/title_font', 'string', 'DejaVu Sans Bold 10')
terminal = home / '.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-terminal.xml'
backup = terminal.with_suffix('.before-apx')
if terminal.exists() and not backup.exists():
    shutil.copy2(terminal, backup)
preset = configparser.ConfigParser()
preset.optionxform = str
preset.read(assets / ('terminalrc-light' if mode == 'light' else 'terminalrc'))
# Modern Xfce terminals observe xfconf; editing terminalrc alone does not update live windows.
for key, value in preset['Configuration'].items():
    prop = '/' + re.sub(r'(?<!^)(?=[A-Z])', '-', key).lower()
    boolean = value in ('TRUE', 'FALSE')
    setting('xfce4-terminal', prop, 'bool' if boolean else 'string', value.lower() if boolean else value)
monitors = subprocess.run(['xrandr', '--listactivemonitors'], env=environment,
                          check=True, capture_output=True, text=True).stdout.splitlines()[1:]
workspaces = max(1, min(16, int(query('xfwm4', '/general/workspace_count', optional=True) or '4')))
wallpaper = assets / ('apx-wallpaper-light-v1.png' if mode == 'light' else 'apx-wallpaper-v1.png')
for monitor in (line.split()[-1] for line in monitors if line.split()):
    for workspace in range(workspaces):
        prop = f'/backdrop/screen0/monitor{monitor}/workspace{workspace}'
        current = query('xfce4-desktop', prop + '/last-image', optional=True)
        if reset or not marker.exists() or current in (str(assets / 'apx-wallpaper-v1.png'),
                                                      str(assets / 'apx-wallpaper-light-v1.png')):
            setting('xfce4-desktop', prop + '/last-image', 'string', wallpaper)
            setting('xfce4-desktop', prop + '/image-style', 'int', 5)
marker.parent.mkdir(parents=True, exist_ok=True)
marker.write_text('3\n')
mode_file.write_text(mode + '\n')
print(f'APX {mode} appearance applied')
