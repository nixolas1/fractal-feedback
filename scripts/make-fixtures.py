from PIL import Image
from pathlib import Path
root=Path('tests/fixtures')
palette=[0,0,0, 40,180,80, 230,30,60, 30,80,230, 250,200,30]+[0,0,0]*251
frames=[]
for i in range(4):
    im=Image.new('P',(8,8),1);im.putpalette(palette);im.info['transparency']=0
    if i==1: im.paste(2,(0,0,3,3))
    if i==2: im.paste(3,(4,1,7,4))
    if i==3: im.paste(4,(1,4,4,7))
    frames.append(im)
frames[0].save(root/'disposal.gif',save_all=True,append_images=frames[1:],duration=[40,80,120,160],loop=1,disposal=[1,2,3,1],transparency=0,optimize=False)
with Image.open(root/'disposal.gif') as gif:
    for i in range(4):
        gif.seek(i);gif.convert('RGBA').save(root/f'gif-frame-{i}.png')
