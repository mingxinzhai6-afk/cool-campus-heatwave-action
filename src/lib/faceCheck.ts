
import { isoPoint } from './iso';
export const TILE_W = 60, TILE_H = 30, Z_H = 26;

export function snapAngle(rotation: number): number {
  const a = ((rotation % 360) + 360) % 360;
  return (Math.round(a / 90) * 90) % 360;
}
function rotXY(x: number, y: number, rotation: number, width: number, height: number): [number, number] {
  const a = (snapAngle(rotation) * Math.PI) / 180;
  const cx = width / 2, cy = height / 2;
  const dx = x - cx, dy = y - cy;
  const cos = Math.cos(a), sin = Math.sin(a);
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}
export function dynamicTileLayout(x: number, y: number, rotation: number, w: number, h: number) {
  const c = [rotXY(x,y,rotation,w,h), rotXY(x+1,y,rotation,w,h), rotXY(x+1,y+1,rotation,w,h), rotXY(x,y+1,rotation,w,h)];
  const xs = c.map(p=>p[0]), ys = c.map(p=>p[1]);
  const i0 = Math.min(...xs), j0 = Math.min(...ys);
  return { i0, j0, i1: Math.max(...xs), j1: Math.max(...ys) };
}
export type FaceDir = 'e' | 'n' | 'w' | 's';
export function faceEdgeAt(i0: number, j0: number, dir: FaceDir, z: number, v: number) {
  switch (dir) {
    case 'e': return [isoPoint(i0+1, j0+1, v*z), isoPoint(i0+1, j0, v*z)];
    case 'n': return [isoPoint(i0, j0, v*z), isoPoint(i0+1, j0, v*z)];
    case 'w': return [isoPoint(i0, j0, v*z), isoPoint(i0, j0+1, v*z)];
    default:  return [isoPoint(i0, j0+1, v*z), isoPoint(i0+1, j0+1, v*z)];
  }
}
export function visibleFaces(snap: number): [FaceDir, FaceDir] {
  const k = ((Math.round(snap / 90) % 4) + 4) % 4;
  const table: [FaceDir, FaceDir][] = [['s','e'],['e','n'],['n','w'],['w','s']];
  return table[k];
}
/** 转出"四个可见边"在世界坐标下的屏幕位置（用于判断哪两条边朝向观察者） */
export function dynamicFaces(i0: number, j0: number, z: number, vis: [FaceDir, FaceDir]) {
  return vis.map((d) => faceEdgeAt(i0, j0, d, z, 0) as any);
}
