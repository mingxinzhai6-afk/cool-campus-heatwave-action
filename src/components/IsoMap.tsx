import { memo, useCallback, useMemo } from 'react';
import {
  GRID, getMap, tileGroups,
  type Hour, type Tile,
} from '../data/campus';
import { GROUPS, GROUP_ORDER, HIGH_HEAT, VULNERABLE_GROUPS, type GroupId } from '../data/groups';
import { TOOLS, type ToolId } from '../data/tools';
import { computeFields, heatField, populationField, type GameState } from '../lib/engine';
import { HOUR_SKY, WEATHER_TINT, Z_H, TYPE_STYLE, heatColor, heatRamp, makeView, mixHex, rnd, shade, toPath, type ViewFrame } from '../lib/iso';
import {
  BuildingBlock, Corridor, GardenPatch, GroundScatter, ParkingDecor, PlazaDecor, RoadDecor, SportMarks,
  WaterSourceMarker, WaterSurface, diamond, faceQuad, peopleDots, ToolObject, type FaceDir,
} from './MapArt';

export type Layers = { heat: boolean; shade: boolean; people: boolean; sensitive: boolean };

type Props = {
  state: GameState;
  levelId?: string;
  hour: Hour;
  layers: Layers;
  toolId: ToolId | null;
  hover: { x: number; y: number } | null;
  adviceMark: { x: number; y: number } | null;
  /** 参谋建议「在地图上标出并采用」的点位（显示红色图钉）。 */
  pickMark: { x: number; y: number } | null;
  focus: { x: number; y: number; label: string }[];
  /** 视角旋转角度：0–360 连续取值，拖到多少度地图就转多少度。 */
  rotation: number;
  onHover: (p: { x: number; y: number } | null) => void;
  onTileClick: (x: number, y: number) => void;
};

/**
 * 等轴 2.5D 地图。
 *
 * 视角是**绕竖直轴的连续旋转**（像转一个摆在桌上的微缩模型）：
 * 所有几何都经 ViewFrame（见 lib/iso.ts 的 makeView）做"先旋转、再等轴投影"，
 * 任意角度都精确成立——地面投影成平行四边形，建筑按外法线连续剔除可见立面，
 * 转过 45° 的整数倍时立面只是恰好侧对观察者（宽度归零），不会突然换脸。
 * 天空、太阳、云朵与天气氛围固定在屏幕上，不随地图转动。
 */
function IsoMap({ state, levelId, hour, layers, toolId, hover, adviceMark, pickMark, focus, rotation, onHover, onTileClick }: Props) {
  const activeLevelId = levelId ?? state.levelId;
  const map = getMap(activeLevelId);
  const heat = useMemo(() => heatField(state, hour), [state, hour]);
  const fields = useMemo(() => computeFields(state, hour), [state, hour]);
  const pop = useMemo(() => populationField(hour, activeLevelId), [hour, activeLevelId]);
  const tool = toolId ? TOOLS[toolId] : null;
  const sky = HOUR_SKY[hour] ?? HOUR_SKY[12];
  const weatherTint = WEATHER_TINT[state.weather] ?? WEATHER_TINT.normal;
  // 开局标出本关重点区域（地图自带的预设设施不算“已放置”）；放下第一处新改造后消失
  const showFocus = focus.length > 0 && state.placements.every((p) => p.fixed) && !state.finished;

  // 保持回调引用稳定，下面的 memo 地块才不会被每次渲染的新函数击穿。
  const handleHover = useCallback((x: number, y: number, on: boolean) => {
    onHover(on ? { x, y } : null);
  }, [onHover]);

  /** 当前角度的连续投影：角度一变，整张地图重新投影。 */
  const fr = useMemo(() => makeView(rotation, map.width, map.height), [rotation, map.width, map.height]);

  // 绘制顺序：沿观察方向的深度升序（越近越后画），遮挡关系在任意角度都正确。
  const layout = useMemo(() => {
    const tiles = map.tiles.filter((tile) => !tile.void);
    const list = tiles.map((tile) => ({ tile, depth: fr.depth(tile.x + 0.5, tile.y + 0.5) }));
    list.sort((a, b) => a.depth - b.depth);
    // 架空连廊：相邻两栋楼（≥2 层）之间架一条，纯外观、不动建筑本身。
    // 只连沿 +i 方向的相邻对、且隔一个连一个——楼群之间稀疏几处，画面干净不杂乱。
    // 每对只从“较远”的一栋画起——近栋的墙面会自然压住连廊的近端，遮挡关系在任何角度都成立。
    const byPos = new Map(tiles.map((t) => [`${t.x},${t.y}`, t]));
    const depthOf = new Map(list.map(({ tile, depth }) => [`${tile.x},${tile.y}`, depth]));
    const corr = new Map<string, { dir: FaceDir; nb: Tile }[]>();
    for (const tile of tiles) {
      if (tile.elev < 2) continue;
      const nb = byPos.get(`${tile.x + 1},${tile.y}`);
      if (!nb || nb.elev < 2) continue;
      if ((tile.x + tile.y) % 2 !== 0) continue;
      const far = (depthOf.get(`${tile.x},${tile.y}`) ?? 0) <= (depthOf.get(`${nb.x},${nb.y}`) ?? 0) ? tile : nb;
      const other = far === tile ? nb : tile;
      const arr = corr.get(`${far.x},${far.y}`) ?? [];
      arr.push({ dir: far === tile ? 'e' : 'w', nb: other });
      corr.set(`${far.x},${far.y}`, arr);
    }
    return { list, tiles, corr };
  }, [map, fr]);

  // viewBox：按旋转后的实际包围盒取景，地图始终居中且完整。
  const baseView = useMemo(() => {
    const corners = [fr.pt(0, 0, 0), fr.pt(map.width, 0, 0), fr.pt(map.width, map.height, 0), fr.pt(0, map.height, 0)];
    const xs = corners.map((c) => c.sx);
    const ys = corners.map((c) => c.sy);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const padX = 80;
    const padTop = 190;
    const padBottom = 110;
    return {
      x: minX - padX,
      y: minY - padTop,
      w: (maxX - minX) + padX * 2,
      h: (maxY - minY) + padTop + padBottom,
    };
  }, [fr, map.width, map.height]);

  const placementAt = useMemo(() => {
    const m = new Map<string, ToolId>();
    for (const p of state.placements) m.set(`${p.x},${p.y}`, p.toolId);
    return m;
  }, [state.placements]);

  const affected = useMemo(() => {
    const set = new Set<string>();
    if (!tool || !hover) return set;
    const r = tool.radius;
    for (let y = Math.max(0, Math.floor(hover.y - r)); y <= Math.min(map.height - 1, Math.ceil(hover.y + r)); y++) {
      for (let x = Math.max(0, Math.floor(hover.x - r)); x <= Math.min(map.width - 1, Math.ceil(hover.x + r)); x++) {
        if (Math.hypot(x - hover.x, y - hover.y) <= r) set.add(`${x},${y}`);
      }
    }
    return set;
  }, [tool, hover]);

  const hoveredTile = hover ? map.tiles[hover.y * GRID + hover.x] : null;

  return (
    <svg
      className="iso-map"
      viewBox={`${baseView.x} ${baseView.y} ${baseView.w} ${baseView.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`校园热力图：${map.name}，视角 ${Math.round(fr.angle)} 度，当前 ${hour}:00，共 ${layout.tiles.length} 个地块`}
    >
      <defs>
        <linearGradient id="plinthLeft" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#b3ccdf" />
          <stop offset="100%" stopColor="#6d93b1" />
        </linearGradient>
        <linearGradient id="plinthRight" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9bb9d2" />
          <stop offset="100%" stopColor="#577e9f" />
        </linearGradient>
        <linearGradient id="groundGrad" x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#eef7fb" />
          <stop offset="100%" stopColor="#dbeaf3" />
        </linearGradient>
        <pattern id="shadeLines" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="9" stroke="#6f9db9" strokeWidth="2.2" opacity="0.25" />
        </pattern>
        <filter id="softShadow" x="-30%" y="-30%" width="160%" height="200%">
          <feDropShadow dx="0" dy="8" stdDeviation="9" floodColor="#425b70" floodOpacity="0.28" />
        </filter>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={sky.top} />
          <stop offset="100%" stopColor={sky.bottom} />
        </linearGradient>
        <radialGradient id="sunGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor={sky.glow} stopOpacity="0.65" />
          <stop offset="100%" stopColor={sky.glow} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="weatherVignette" cx="0.5" cy="0.46" r="0.78">
          <stop offset="46%" stopColor={weatherTint.color} stopOpacity="0" />
          <stop offset="100%" stopColor={weatherTint.color} stopOpacity="1" />
        </radialGradient>
      </defs>

      {/* —— 天空与太阳（固定在屏幕上，不随视角旋转） —— */}
      <g className="sky" pointerEvents="none">
        <rect x={baseView.x} y={baseView.y} width={baseView.w} height={baseView.h} fill="url(#skyGrad)" className="sky-tint" />
        <g className="sun" transform={`translate(${baseView.x + baseView.w * 0.5 + sky.sunPos[0] * 0.6} ${baseView.y + baseView.h * 0.16 + sky.sunPos[1] * 0.35})`}>
          <circle r="150" fill="url(#sunGlow)" />
          <circle r="23" fill={sky.sun} />
        </g>
      </g>

      {/* —— 云朵（固定在屏幕上） —— */}
      <g className="clouds">
        <Cloud x={baseView.x + baseView.w * 0.2} y={baseView.y + baseView.h * 0.1} scale={1} />
        <Cloud x={baseView.x + baseView.w * 0.78} y={baseView.y + baseView.h * 0.14} scale={0.75} />
        <Cloud x={baseView.x + baseView.w * 0.5} y={baseView.y + baseView.h * 0.06} scale={0.58} />
      </g>

      {/* ====== 以下随视角连续旋转（绕竖直轴）：托板 + 地块 + 交互层 + 标注 ====== */}
      <g>
        {/* —— 微缩模型托板（四个角随视角一起转动） —— */}
        {(() => {
          const inset = 0.3;
          const lift = -0.7;
          const plan: [number, number][] = [
            [lift, lift],
            [map.width + inset, lift],
            [map.width + inset, map.height + inset],
            [lift, map.height + inset],
          ];
          const ground = plan.map(([i, j]) => fr.pt(i, j, 0));
          const sunk = plan.map(([i, j]) => fr.pt(i, j, -2.2));
          // 最靠近观察者的角（屏幕最下方），与它相邻的两条边就是可见侧面
          const byY = ground.reduce((best, p, k) => (p.sy > ground[best].sy ? k : best), 0);
          const left = (byY + 3) % 4;
          const right = (byY + 1) % 4;
          const top = toPath(ground);
          const faceL = toPath([ground[byY], ground[left], sunk[left], sunk[byY]]);
          const faceR = toPath([ground[byY], ground[right], sunk[right], sunk[byY]]);
          return (
            <g filter="url(#softShadow)">
              <path d={faceL} fill="url(#plinthLeft)" />
              <path d={faceR} fill="url(#plinthRight)" />
              <path d={top} fill="url(#groundGrad)" />
            </g>
          );
        })()}

        {/* —— 地块与建筑（按等轴深度排序） —— */}
        <g>
          {layout.list.map(({ tile }) => (
            <TileNode
              key={tile.id}
              tile={tile}
              fr={fr}
              hour={hour}
              heat={heat[tile.y * GRID + tile.x]}
              fields={fields}
              pop={pop.outdoor[tile.y * GRID + tile.x]}
              totalPop={pop.total[tile.y * GRID + tile.x]}
              groups={tileGroups(tile, hour)}
              layers={layers}
              placedTool={placementAt.get(`${tile.x},${tile.y}`) ?? null}
              ghostTool={toolId}
              ghost={Boolean(tool && hover && affected.has(`${tile.x},${tile.y}`) && !placementAt.has(`${tile.x},${tile.y}`))}
              advice={adviceMark?.x === tile.x && adviceMark?.y === tile.y}
              pick={pickMark?.x === tile.x && pickMark?.y === tile.y}
              corr={layout.corr.get(`${tile.x},${tile.y}`)}
            />
          ))}
        </g>

        {/* —— 交互层：地面四边形 + 可见立面，保证任何角度都能点到 —— */}
        <g className="hit-layer">
          {layout.list.map(({ tile }) => {
            const z = tile.elev;
            return (
              <g
                key={tile.id}
                style={{ cursor: toolId ? 'crosshair' : 'pointer' }}
                onPointerEnter={() => handleHover(tile.x, tile.y, true)}
                onPointerLeave={() => handleHover(tile.x, tile.y, false)}
                onClick={() => onTileClick(tile.x, tile.y)}
              >
                <path d={toPath(diamond(fr, tile.x, tile.y, z))} fill="rgba(0,0,0,0)" />
                {z > 0 && fr.visible.map((dir) => (
                  <path key={dir} d={toPath(faceQuad(fr, tile.x, tile.y, z, dir))} fill="rgba(0,0,0,0)" />
                ))}
                <title>{tile.name}</title>
              </g>
            );
          })}
        </g>

        {/* —— 悬停轮廓 —— */}
        {hoveredTile && (
          <path
            d={toPath(diamond(fr, hoveredTile.x, hoveredTile.y, hoveredTile.elev))}
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.4"
            strokeLinejoin="round"
            opacity="0.95"
          />
        )}

        {/* —— 任务聚焦点（开局标出本关重点区域） —— */}
        {showFocus && focus.map((f) => {
          const c = fr.pt(f.x + 0.5, f.y + 0.5, 0);
          return (
            <g key={`${f.x},${f.y}`} className="focus" pointerEvents="none">
              <ellipse className="focus-ring" cx={c.sx} cy={c.sy} rx={30} ry={15} fill="none" stroke="#ffd166" strokeWidth={2.4} strokeDasharray="7 6" />
              <ellipse className="focus-ring delay" cx={c.sx} cy={c.sy} rx={30} ry={15} fill="none" stroke="#ffd166" strokeWidth={2.4} strokeDasharray="7 6" />
              <g transform={`translate(${c.sx} ${c.sy - 26})`}>
                <rect
                  className="focus-tag"
                  x={-Math.max(30, f.label.length * 6.6)}
                  y={-11}
                  width={Math.max(60, f.label.length * 13.2)}
                  height={21}
                  rx={10.5}
                  fill="rgba(20,15,46,0.86)"
                  stroke="#ffd166"
                  strokeWidth={1.4}
                />
                <text className="focus-label" y={4} textAnchor="middle" fill="#ffe6a8" stroke="#1b1240" strokeWidth={2.4} paintOrder="stroke">{f.label}</text>
              </g>
            </g>
          );
        })}

        {/* —— 地标文字（随地图一起转动，保持贴在各自地块上） —— */}
        <g className="labels">
          {layout.list.filter(({ tile }) => tile.landmark && !(showFocus && focus.some((f) => f.x === tile.x && f.y === tile.y))).map(({ tile }) => {
            const p = fr.pt(tile.x + 0.5, tile.y + 0.5, tile.elev + 0.25);
            return (
              <text key={tile.id} x={p.sx} y={p.sy - 2} textAnchor="middle" className="tile-label">
                {tile.name}
              </text>
            );
          })}
        </g>
      </g>

      {/* —— 天气氛围 / 雨丝 —— */}
      <g className="atmosphere" pointerEvents="none">
        <rect x={baseView.x} y={baseView.y} width={baseView.w} height={baseView.h} fill="url(#weatherVignette)" opacity={weatherTint.opacity} className="weather-tint" />
        {state.weather === 'rain' && (
          <g className="rain">
            {Array.from({ length: 46 }).map((_, i) => {
              const x = baseView.x + rnd(i, 3, 2) * baseView.w;
              const y = baseView.y + rnd(i, 7, 5) * baseView.h;
              return <line key={i} x1={x} y1={y} x2={x - 6} y2={y + 22} style={{ animationDelay: `${(rnd(i, 11, 9) * 1.2).toFixed(2)}s` }} />;
            })}
          </g>
        )}
      </g>
    </svg>
  );
}

function Cloud({ x, y, scale }: { x: number; y: number; scale: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g className="cloud">
        <ellipse cx="0" cy="0" rx="34" ry="15" fill="#ffffff" opacity="0.92" />
        <ellipse cx="-22" cy="6" rx="20" ry="10" fill="#ffffff" opacity="0.75" />
        <ellipse cx="24" cy="6" rx="22" ry="11" fill="#ffffff" opacity="0.82" />
      </g>
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * 单个地块
 * ------------------------------------------------------------------ */
type TileNodeProps = {
  tile: Tile;
  fr: ViewFrame;
  hour: Hour;
  heat: number;
  fields: ReturnType<typeof computeFields>;
  pop: number;
  totalPop: number;
  groups: Record<GroupId, number>;
  layers: Layers;
  placedTool: ToolId | null;
  ghostTool: ToolId | null;
  ghost: boolean;
  advice: boolean;
  /** 参谋建议标出的点位：在地块上方显示红色图钉。 */
  pick: boolean;
  /** 通向相邻楼栋的架空连廊（从本栋画向该方向）。 */
  corr?: { dir: FaceDir; nb: Tile }[];
};

/**
 * memo 化的地块：悬停、放置预览等交互只改变少数地块的 props，
 * 其余约 300 个地块直接跳过重渲染（配合上面稳定的回调引用）。
 * 视角旋转时 fr 变化，全部地块重新投影——这正是"拖到多少度就转多少度"。
 */
const TileNode = memo(function TileNode({ tile, fr, hour, heat, fields, pop, totalPop, groups, layers, placedTool, ghostTool, ghost, advice, pick, corr }: TileNodeProps) {
  const i = tile.y * GRID + tile.x;
  const style = TYPE_STYLE[tile.type];
  const center = fr.pt(tile.x + 0.5, tile.y + 0.5, tile.elev);
  const groundCenter = fr.pt(tile.x + 0.5, tile.y + 0.5, 0);
  const isBuilding = tile.elev > 0;
  const isVenue = /图书馆|阅览馆/.test(tile.name);

  // 热力浓淡随温度上升：偏凉的地块保留材质色，热的地方才被热力色吞没。
  const ramp = heatRamp(heat);
  const heatTint = layers.heat ? heatColor(heat) : null;
  const groundFill = heatTint ? mixHex(style.top, heatTint, 0.18 + 0.62 * ramp) : style.top;

  return (
    <g className="tile">
      {isBuilding ? (
        <>
          <BuildingBlock fr={fr} tile={tile} heatTint={heatTint} heat={heat} greenroof={placedTool === 'greenroof'} />
          {corr && corr.map((c, k) => <Corridor key={k} fr={fr} tile={tile} nb={c.nb} dir={c.dir} />)}
        </>
      ) : (
        <>
          <path d={toPath(diamond(fr, tile.x, tile.y, 0))} fill={groundFill} stroke={shade(style.top, -0.13)} strokeWidth="0.9" strokeLinejoin="round" />

          {tile.type === 'road' && <RoadDecor fr={fr} i0={tile.x} j0={tile.y} opacity={layers.heat ? 0.4 : 0.9} />}
          {tile.type === 'plaza' && <PlazaDecor fr={fr} i0={tile.x} j0={tile.y} />}
          {tile.type === 'garden' && <GardenPatch fr={fr} i0={tile.x} j0={tile.y} />}
          {tile.type === 'sport' && <SportMarks fr={fr} i0={tile.x} j0={tile.y} />}
          {tile.type === 'water' && <WaterSurface fr={fr} i0={tile.x} j0={tile.y} />}
          {tile.type === 'parking' && <ParkingDecor fr={fr} i0={tile.x} j0={tile.y} />}
          {(tile.type === 'grass' || tile.type === 'tree' || tile.type === 'garden') && <GroundScatter fr={fr} tile={tile} i0={tile.x} j0={tile.y} />}
        </>
      )}

      {layers.heat && heat >= 80 && !isBuilding && (
        <text x={groundCenter.sx} y={groundCenter.sy + 4} textAnchor="middle" className="heat-number">
          {Math.round(heat)}
        </text>
      )}

      {/* 极热地块：亮边 + 红色叠加，不用混合模式也能看出“这里最烫” */}
      {layers.heat && heat >= 85 && (
        <path
          d={toPath(diamond(fr, tile.x, tile.y, tile.elev + 0.03))}
          fill="#ff2d10"
          fillOpacity="0.2"
          stroke="#fff3c4"
          strokeWidth="2"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      )}

      {layers.shade && fields.shade[i] >= 3 && (
        <path d={toPath(diamond(fr, tile.x, tile.y, tile.elev + 0.02))} fill="url(#shadeLines)" stroke="#7a6fe0" strokeWidth="1" strokeOpacity="0.45" />
      )}

      {layers.people && peopleDots(fr, tile.x, tile.y, tile.elev, groups, pop)}

      {layers.sensitive && vulnerableShare(groups) >= 0.35 && heat >= HIGH_HEAT && (
        <path d={toPath(diamond(fr, tile.x, tile.y, tile.elev + 0.04))} fill="none" stroke={GROUPS.workers.color} strokeWidth="3" strokeDasharray="4 4" strokeLinejoin="round" className="pulse" />
      )}

      {/* 场馆（图书馆/阅览馆）标一个可点击的冰蓝角标，提示可以直接打开纳凉设置 */}
      {isVenue && (
        <g className="venue-pin" transform={`translate(${center.sx} ${center.sy - (isBuilding ? 4 : 0) - 18})`}>
          <circle r="9" fill="#e9f7ff" stroke="#3f8fb8" strokeWidth="1.6" />
          <path d="M-4.5,-1.5 h9 v6 h-9 Z M-3,-1.5 v-3 h6 v3" fill="none" stroke="#2c6b8c" strokeWidth="1.3" strokeLinejoin="round" />
        </g>
      )}

      {tile.waterSource && <WaterSourceMarker fr={fr} i0={tile.x} j0={tile.y} kind={tile.waterSource} />}
      {placedTool && placedTool !== 'greenroof' && <ToolObject fr={fr} i0={tile.x} j0={tile.y} elev={tile.elev} toolId={placedTool} hour={hour} />}

      {ghost && ghostTool && (
        <g opacity="0.62" className="ghost">
          <path d={toPath(diamond(fr, tile.x, tile.y, tile.elev + 0.05))} fill="#ffffff" opacity="0.4" />
          <path d={toPath(diamond(fr, tile.x, tile.y, tile.elev + 0.05))} fill="none" stroke="#ffffff" strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" />
          <ToolObject fr={fr} i0={tile.x} j0={tile.y} elev={tile.elev} toolId={ghostTool} hour={hour} />
        </g>
      )}

      {advice && !ghostTool && (
        <g transform={`translate(${groundCenter.sx} ${groundCenter.sy - tile.elev * Z_H - 26})`}>
          <g className="advice-mark">
            <circle r="11" fill="#ffd166" stroke="#ffffff" strokeWidth="2" />
            <text y="4.5" textAnchor="middle" fontSize="13" fontWeight="700" fill="#4a3a12">荐</text>
          </g>
        </g>
      )}

      {pick && (
        <g transform={`translate(${groundCenter.sx} ${groundCenter.sy - tile.elev * Z_H - 34})`} pointerEvents="none">
          <g className="pick-mark">
            <text textAnchor="middle" fontSize="24">📍</text>
          </g>
        </g>
      )}

      {layers.people && totalPop >= 140 && (
        <text x={center.sx} y={center.sy - (isBuilding ? 6 : 0) - 14} textAnchor="middle" className="pop-label">
          {Math.round(totalPop)}
        </text>
      )}
    </g>
  );
});

function vulnerableShare(groups: Record<GroupId, number>): number {
  let vuln = 0;
  let all = 0;
  for (const g of GROUP_ORDER) {
    all += groups[g];
    if (VULNERABLE_GROUPS.includes(g)) vuln += groups[g];
  }
  return all > 0 ? vuln / all : 0;
}

/**
 * memo：拖视角滑条时 App 会高频 setState（快速通道），只要 rotation 还没轮到
 * 延迟渲染，这里的其他 props 都保持原引用，整张地图的重绘就会被跳过。
 */
export default memo(IsoMap);
