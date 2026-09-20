import * as THREE from 'three';

/**
 * 太阳 / 主光方向：与 Game 中的主平行光方向保持一致，
 * 星球的昼夜分界、大气散射才能和场景光照对得上。
 */
export const SUN_DIRECTION = new THREE.Vector3(6, 14, 10).normalize();

/**
 * 程序化 HDR 环境贴图：一小间"太空摄影棚"——渐变天空 + 几块高亮面光。
 * 用 PMREM 预卷积后作为 scene.environment，
 * 让金属材质（metalness 高）有真正的反射内容，而不是靠拉高灯光强度提亮。
 */
export function createEnvironmentTexture(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];

  // 1. 渐变天空：上方冷蓝、地平线暗青、下方近黑
  const skyGeo = new THREE.SphereGeometry(60, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x2b4c86) },
      uHorizon: { value: new THREE.Color(0x0b1224) },
      uBottom: { value: new THREE.Color(0x03040a) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uBottom;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y;
        vec3 c = h > 0.0
          ? mix(uHorizon, uTop, pow(h, 0.7))
          : mix(uHorizon, uBottom, pow(-h, 0.55));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  disposables.push(skyGeo, skyMat);

  // 2. 面光：颜色可以超过 1（PMREM 用半浮点 RT，保留 HDR）
  const addPanel = (
    rgb: [number, number, number],
    size: number,
    position: THREE.Vector3,
  ): void => {
    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]),
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
    disposables.push(geo, mat);
  };

  // 冷白主光（科幻蓝）：金属的主要反射来源
  addPanel([3.2, 3.8, 5.2], 16, new THREE.Vector3(12, 16, 9));
  // 青色轮廓光：给机身边缘提供漂亮的冷色高光
  addPanel([1.0, 2.6, 3.8], 12, new THREE.Vector3(-15, 5, -7));
  // 暖橙补光（能量 / 警告色）
  addPanel([2.6, 1.2, 0.55], 8, new THREE.Vector3(7, -9, 7));
  // 紫色环境点缀
  addPanel([0.8, 0.5, 2.1], 6, new THREE.Vector3(-6, 11, 13));

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.03, 0.1, 200);
  pmrem.dispose();
  for (const item of disposables) item.dispose();

  const texture = target.texture;
  texture.name = 'ProceduralEnvironment';
  return texture;
}
