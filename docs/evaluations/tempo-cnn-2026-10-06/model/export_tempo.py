import os, sys, torch, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); R = os.path.abspath(os.path.join(HERE, '../../../..'))
# Downloads, features and checkpoints live under a work root (the model thread used /tmp/claude-0).
W = os.environ.get('DGE_WORK', '/tmp/claude-0')
PT, OUT = sys.argv[1:3]
src = open(os.path.join(HERE, 'train_tempo.py')).read().split("ok = lambda")[0]
ck = torch.load(PT, map_location='cpu')
src = src.replace("rows = [r for r in json.load(open(labels))['tempo'] if 30 <= r['bpm'] <= 285]", "rows = []").replace("MU = float(np.mean([x.mean() for x in X.values()])); SD = float(np.mean([x.std() for x in X.values()]))", f"MU = {ck['mu']}; SD = {ck['sd']}")
sys.argv = ['x', 'final', '/dev/null', f'{W}/models/tmp']; ns = {}; exec(src, ns)
net = ns['Net'](); net.load_state_dict(ck['state']); net.eval()
x = torch.randn(2, 215, 40)
torch.onnx.export(net, x, OUT, input_names=['mel'], output_names=['logits'], dynamic_axes={'mel': {0: 'windows'}}, opset_version=17, dynamo=False)
import onnx, onnxruntime as ort
m = onnx.load(OUT); onnx.save(m, OUT, save_as_external_data=False)
s = ort.InferenceSession(OUT); a = s.run(None, {'mel': x.numpy()})[0]; b = net(x).detach().numpy()
print('max diff', float(abs(a - b).max()))
