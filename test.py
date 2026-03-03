from rhino3dm import *
import base64

import compute_rhino3d.Util
import compute_rhino3d.Mesh

with open('/Users/samchin/Downloads/multiply_by_7.gh', 'rb') as f:
    data = f.read()

data = base64.b64encode(data).decode('utf-8')

# compute_rhino3d.Util.authToken = "eyJhbGciOiJIUzI1NiJ9.eyJjIjoxLCJwIjoxLCJiNjRpdiI6ImxTSVFWWXZVc1lTaFIraTVpTyt0SGc9PSIsImI2NGN0IjoiRGF1ZVVPSDZ2akgxT0o1UFVjZWFsWG4xM3poV3lIbWFybEtkc0g0SUhsZ0ZNbzd5QXloUnY1VlE5MXhhNWdvVXBRTGhHZE5GN3lESDRhS1RjOG1QNXhvRis2YUhFUURpYVlKOXA5LzVWZ2s9IiwiaWF0IjoxNzcyNDIyNDkzfQ.467keJltJvluFyMzqXZlyttcru9KtXgsABNrhUOcvtQ"
compute_rhino3d.Util.apiKey = "214fdfe3-223c-4863-b9ab-68200c1466af"
compute_rhino3d.Util.url = "http://rhinobox/"
center = Point3d(250, 250, 0)
sphere = Sphere(center, 100)
brep = sphere.ToBrep()
meshes = compute_rhino3d.Mesh.CreateFromBrep(brep)
print("Computed mesh with {} faces".format(len(meshes[0].Faces)))
