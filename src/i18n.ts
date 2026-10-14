export type Lang = 'zh' | 'en';

const D: Record<string, [string, string]> = {
  title: ['白模預演工作室', 'Greybox Previs Studio'],
  add: ['新增', 'Add'],
  mannequin: ['人偶', 'Mannequin'],
  box: ['方塊', 'Box'], cylinder: ['圓柱', 'Cylinder'], sphere: ['球體', 'Sphere'], cone: ['圓錐', 'Cone'],
  plane: ['地板', 'Floor'], stairs: ['樓梯', 'Stairs'], wall: ['牆', 'Wall'], table: ['桌子', 'Table'], chair: ['椅子', 'Chair'],
  move: ['移動 (W)', 'Move (W)'], rotate: ['旋轉 (E)', 'Rotate (E)'], scale: ['縮放 (R)', 'Scale (R)'],
  poseMode: ['姿勢模式', 'Pose mode'],
  newProject: ['新專案', 'New'], save: ['儲存 JSON', 'Save JSON'], load: ['開啟 JSON', 'Open JSON'], demo: ['範例場景', 'Examples'],
  exLobby: ['大廳走位（內建）', 'Lobby blocking (built-in)'], exSidestep: ['閃身步', 'Sidestep dodge'],
  outliner: ['場景物件', 'Outliner'],
  props: ['屬性', 'Properties'], export: ['匯出', 'Export'], ai: ['AI 生成', 'AI Generate'], view: ['顯示', 'View'],
  nothingSelected: ['尚未選取物件。點選視窗中的物件。', 'Nothing selected. Click an object in the viewport.'],
  name: ['名稱', 'Name'], position: ['位置', 'Position'], rotation: ['旋轉 (度)', 'Rotation (deg)'], scaleL: ['縮放', 'Scale'],
  clip: ['動作片段', 'Animation clip'], none: ['（無，手動姿勢）', '(none, manual pose)'], speed: ['速度', 'Speed'],
  posePreset: ['姿勢預設', 'Pose presets'], bone: ['骨骼', 'Bone'],
  duplicate: ['複製', 'Duplicate'], delete: ['刪除', 'Delete'],
  keySel: ['K 選取物件', 'Key selection'], keyPose: ['K 姿勢', 'Key pose'], keyCam: ['K 攝影機', 'Key camera'], delKey: ['刪除此處關鍵影格', 'Delete keys here'],
  shot: ['運鏡', 'Camera shot'], applyShot: ['套用運鏡', 'Apply shot'],
  pushIn: ['推近', 'Push-in'], dolly: ['橫移', 'Dolly'], orbit: ['環繞', 'Orbit'], crane: ['升降', 'Crane'], static: ['固定', 'Static'],
  duration: ['長度 (秒)', 'Duration (s)'], fps: ['FPS', 'FPS'], ease: ['緩動', 'Easing'],
  outline: ['輪廓線', 'Outline'], ao: ['環境光遮蔽', 'Ambient occlusion'], shadows: ['陰影', 'Shadows'], grid: ['格線', 'Grid'], bg: ['背景色', 'Background'],
  width: ['寬', 'Width'], height: ['高', 'Height'], transparent: ['透明背景', 'Transparent background'],
  exportStill: ['匯出靜態圖', 'Export still'], pngBeauty: ['PNG 白模', 'PNG beauty'], pngDepth: ['深度圖', 'Depth pass'], pngNormal: ['法線圖', 'Normal pass'], pngEdge: ['邊緣圖', 'Edge pass'],
  exportSeq: ['匯出序列圖 ZIP', 'Export image sequence ZIP'], exportVideo: ['匯出影片', 'Export video'], passes: ['通道', 'Passes'],
  videoPass: ['影片通道', 'Video pass'], format: ['格式', 'Format'], cancel: ['取消', 'Cancel'],
  provider: ['服務', 'Provider'], status: ['狀態', 'Status'], docs: ['官方文件', 'Docs'],
  apiKey: ['API 金鑰', 'API key'], accessKey: ['Access Key', 'Access Key'], secretKey: ['Secret Key', 'Secret Key'],
  remember: ['記在這台瀏覽器 (localStorage，不建議在共用電腦)', 'Remember in this browser (localStorage — not on shared computers)'],
  connection: ['連線方式', 'Connection'], direct: ['瀏覽器直連（可能被 CORS 擋）', 'Direct from browser (may hit CORS)'], proxy: ['本機 Proxy（金鑰放 .env）', 'Local proxy (keys in .env)'],
  mode: ['產生類型', 'Output'], image: ['圖片', 'Image'], video: ['影片', 'Video'],
  source: ['輸入', 'Input'], srcBeauty: ['目前畫面 (白模)', 'Current view (greybox)'], srcDepth: ['目前畫面 (深度)', 'Current view (depth)'], srcEdge: ['目前畫面 (邊緣)', 'Current view (edges)'], srcVideo: ['最後匯出的影片', 'Last exported video'], srcUrl: ['網址', 'URL'], srcNone: ['無（純文字）', 'None (text only)'],
  inputUrl: ['輸入網址', 'Input URL'],
  prompt: ['提示詞', 'Prompt'], negative: ['負面提示詞', 'Negative prompt'], strength: ['變化強度', 'Strength'], model: ['模型', 'Model'], aspectRatio: ['比例', 'Aspect'], extra: ['額外 JSON 參數', 'Extra JSON params'],
  generate: ['送出生成', 'Generate'], results: ['結果', 'Results'],
  keyWarning: ['金鑰只存在記憶體；勾選記住才會寫入 localStorage。請勿把金鑰貼到 repo。', 'Keys stay in memory; only stored in localStorage if you tick Remember. Never commit keys.'],
  implemented: ['已實作（依官方文件，未實測）', 'Implemented (from docs, not live-tested)'], stub: ['尚未實作', 'Stub'],
  play: ['播放', 'Play'], pause: ['暫停', 'Pause'],
  hint: ['左鍵選取．右鍵平移．滾輪縮放．姿勢模式下點藍點選骨骼', 'LMB select · RMB pan · wheel zoom · in pose mode click blue dots to pick bones'],
};

let lang: Lang = (localStorage.getItem('gps.lang') as Lang) || 'zh';
export const getLang = () => lang;
export function t(key: string): string {
  const e = D[key];
  return e ? e[lang === 'zh' ? 0 : 1] : key;
}
export function setLang(l: Lang): void {
  lang = l;
  localStorage.setItem('gps.lang', l);
  document.documentElement.lang = l === 'zh' ? 'zh-Hant-TW' : 'en';
  applyI18n();
}
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle!)));
  root.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => (el.placeholder = t(el.dataset.i18nPh!)));
}
