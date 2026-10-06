import os, sys, torch
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'train_key.py')).read().split("if mode == 'cv':")[0]
OUT = sys.argv[2]; ck = torch.load(sys.argv[1], map_location='cpu')
src = src.replace("rows = json.load(open(labels))['key']", "rows = []").replace("MU = np.mean([x.mean() for x in X.values()]); SD = np.mean([x.std() for x in X.values()])", f"MU = {ck['mu']}; SD = {ck['sd']}")
sys.argv = ['x', 'final', '/dev/null', '/tmp/claude-0/models/tmp']; ns = {}; exec(src, ns)
net = ns['Net'](); net.load_state_dict(ck['state']); net.eval()
x = torch.randn(1, 100, 120)
print(net(x).shape)
torch.onnx.export(net, x, OUT, input_names=['spec'], output_names=['logits'], dynamic_axes={'spec': {0: "batch", 1: "frames"}}, opset_version=17)
