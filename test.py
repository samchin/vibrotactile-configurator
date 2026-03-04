import json
from pathlib import Path

from rhino3dm import *
import base64

import compute_rhino3d.Util
import compute_rhino3d.Mesh

# Load config
with open(Path(__file__).parent / "config.json") as f:
    config = json.load(f)
compute_rhino3d.Util.apiKey = config["apiKey"]
compute_rhino3d.Util.url = config["url"]

with open('/Users/samchin/Downloads/multiply_by_7.gh', 'rb') as f:
    data = f.read()

data = base64.b64encode(data).decode('utf-8')
center = Point3d(250, 250, 0)
sphere = Sphere(center, 100)
brep = sphere.ToBrep()
meshes = compute_rhino3d.Mesh.CreateFromBrep(brep)
print("Computed mesh with {} faces".format(len(meshes[0].Faces)))
