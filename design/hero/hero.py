# Blender source for the Resonance README hero (public/hero.png). The scene file is hero.blend.
import bpy, random, math
from mathutils import Vector
random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc=bpy.context.scene
def emat(name,col,strength):
    m=bpy.data.materials.new(name);m.use_nodes=True;nt=m.node_tree;nt.nodes.clear()
    o=nt.nodes.new('ShaderNodeOutputMaterial');e=nt.nodes.new('ShaderNodeEmission')
    e.inputs[0].default_value=(*col,1);e.inputs[1].default_value=strength
    nt.links.new(e.outputs[0],o.inputs[0]);return m
def glass(name,col):
    m=bpy.data.materials.new(name);m.use_nodes=True;b=m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value=(*col,1);b.inputs['Roughness'].default_value=0.25
    b.inputs['Emission Color'].default_value=(*col,1);b.inputs['Emission Strength'].default_value=1.2
    return m
P=(0.486,0.361,1.0); L=(0.77,0.71,0.99)
lin=lambda c:tuple(x**2.2 for x in c)
mNode=emat('node',lin((0.68,0.6,1)),1.8); mAcc=emat('acc',lin(P),4); mLine=emat('line',lin(P),1.6)
mBar=emat('bar',lin((0.55,0.42,1)),2.2); mDoc=glass('doc',lin((0.35,0.27,0.8))); mDocL=emat('docl',lin(L),2)
# nodes positioned on right half
pts=[]
for i in range(34):
    p=Vector((random.uniform(0.8,6.0),random.uniform(-5,6),random.uniform(-2.3,2.3)))
    pts.append(p)
def obj_add(o,m):
    o.data.materials.append(m)
kinds=[]
for i,p in enumerate(pts):
    k=i%3; kinds.append(k)
    if k==0:
        bpy.ops.mesh.primitive_uv_sphere_add(radius=random.uniform(0.08,0.2),location=p,segments=32,ring_count=16)
        obj_add(bpy.context.object,random.choice([mNode,mAcc])); bpy.ops.object.shade_smooth()
    elif k==1: # waveform bars
        n=7; rot=random.uniform(-0.5,0.5)
        for j in range(n):
            h=0.12+0.45*abs(math.sin(j*1.3+i))
            off=Vector(((j-n/2)*0.09,0,0))
            bpy.ops.mesh.primitive_cube_add(size=1,location=p+off)
            o=bpy.context.object;o.scale=(0.045,0.045,h);obj_add(o,mBar)
            bpy.ops.object.modifier_add(type='BEVEL');o.modifiers[0].width=0.015;o.modifiers[0].segments=3
    else: # document
        bpy.ops.mesh.primitive_cube_add(size=1,location=p,rotation=(random.uniform(-.3,.3),0,random.uniform(-.6,.6)))
        o=bpy.context.object;o.scale=(0.42,0.02,0.56);obj_add(o,mDoc)
        bpy.ops.object.modifier_add(type='BEVEL');o.modifiers[0].width=0.03;o.modifiers[0].segments=4
        for r in range(4):
            bpy.ops.mesh.primitive_cube_add(size=1,location=(0,-0.6,0.28-r*0.16))
            l=bpy.context.object;l.parent=o;l.scale=(0.7 if r else 0.5,0.3,0.035);obj_add(l,mDocL)
# connections: nearest neighbours, curved
def curve(a,b):
    cd=bpy.data.curves.new('c','CURVE');cd.dimensions='3D';cd.bevel_depth=0.006;cd.bevel_resolution=2
    s=cd.splines.new('BEZIER');s.bezier_points.add(1)
    mid=(a+b)/2+Vector((0,0,0.25*(a-b).length*random.choice([-1,1])*0.4))
    for bp,co in zip(s.bezier_points,[a,b]):
        bp.co=co;bp.handle_left_type=bp.handle_right_type='FREE'
        bp.handle_left=bp.handle_right=co+(mid-co)*0.6
    o=bpy.data.objects.new('c',cd);sc.collection.objects.link(o);cd.materials.append(mLine)
seen=set()
for i,a in enumerate(pts):
    nb=sorted(range(len(pts)),key=lambda j:(pts[j]-a).length)[1:4]
    for j in nb:
        if (j,i) in seen:continue
        seen.add((i,j));curve(a,pts[j])
# soft purple haze plane behind
bpy.ops.mesh.primitive_plane_add(size=40,location=(5,14,0),rotation=(math.pi/2,0,0))
hp=bpy.context.object;hm=bpy.data.materials.new('haze');hm.use_nodes=True;n=hm.node_tree;n.nodes.clear()
o=n.nodes.new('ShaderNodeOutputMaterial');e=n.nodes.new('ShaderNodeEmission');t=n.nodes.new('ShaderNodeTexCoord');gr=n.nodes.new('ShaderNodeTexGradient');gr.gradient_type='SPHERICAL'
mp=n.nodes.new('ShaderNodeMapping');mp.inputs['Scale'].default_value=(0.08,0.12,1);mp.inputs['Location'].default_value=(0,0,0)
ra=n.nodes.new('ShaderNodeValToRGB');ra.color_ramp.elements[0].color=(0,0,0,1);ra.color_ramp.elements[1].color=(*lin((0.3,0.2,0.75)),1)
n.links.new(t.outputs['Object'],mp.inputs[0]);n.links.new(mp.outputs[0],gr.inputs[0]);n.links.new(gr.outputs[0],ra.inputs[0]);n.links.new(ra.outputs[0],e.inputs[0]);e.inputs[1].default_value=0.12;n.links.new(e.outputs[0],o.inputs[0])
hp.data.materials.append(hm)
# world & camera
w=bpy.data.worlds.new('w');sc.world=w;w.use_nodes=True;w.node_tree.nodes['Background'].inputs[0].default_value=(0.004,0.004,0.012,1)
cam=bpy.data.cameras.new('cam');cam.lens=50
co=bpy.data.objects.new('cam',cam);sc.collection.objects.link(co);sc.camera=co
co.location=(-5.5,-14,1.0);target=Vector((-0.6,0,0))
co.rotation_euler=(target-co.location).to_track_quat('-Z','Y').to_euler()
cam.dof.use_dof=True;cam.dof.focus_distance=(Vector((3,0,0))-co.location).length;cam.dof.aperture_fstop=0.12
sc.render.engine='CYCLES';sc.cycles.samples=160;sc.cycles.use_denoising=True;sc.cycles.device='CPU'
sc.render.resolution_x=1920;sc.render.resolution_y=1080
sc.view_settings.view_transform='AgX';sc.view_settings.look='AgX - Medium High Contrast'
sc.use_nodes=True;nt=sc.node_tree;rl=nt.nodes['Render Layers'];comp=nt.nodes['Composite']
g=nt.nodes.new('CompositorNodeGlare');g.glare_type='FOG_GLOW';g.quality='HIGH';g.size=9;g.threshold=0.4;g.mix=-0.3
nt.links.new(rl.outputs[0],g.inputs[0]);nt.links.new(g.outputs[0],comp.inputs[0])
sc.render.filepath='/workspace/resonance/hero.png'
bpy.ops.wm.save_as_mainfile(filepath='/workspace/resonance/hero.blend')
bpy.ops.render.render(write_still=True)
