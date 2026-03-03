import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
	callChatCompletionsForJson,
	callChatCompletionsForText,
	type ModelEndpointConfig,
} from './ai/chatCompletions';
import { parseJsonFromModelText } from './ai/json';
import { asDataUrlFromBase64, base64ToObjectUrl, extractLastFrameAsDataUrl } from './ai/media';

const PALETTE = {
	bg0: '#07090D',
	bg1: '#0B1118',	
	text: 'rgba(255,255,255,0.92)',
	muted: 'rgba(255,255,255,0.62)',
	panel: 'rgba(255,255,255,0.06)',
	border: 'rgba(255,255,255,0.12)',
	accentA: '#19D3AE',
	accentB: '#A3FF6F',
	danger: '#FB923C',
	ok: '#22C55E',
};

type AppSettings = {
	script: ModelEndpointConfig;
	image: ModelEndpointConfig;
	video: ModelEndpointConfig;
	maxSegmentSeconds: number;
	segmentsCount: number;
	imageWidth: number;
	imageHeight: number;
};

type SegmentOutput = {
	segmentIndex: number;
	seedImageSrc: string;
	videoSrc?: string;
	videoMimeType?: string;
	lastFrameSrc?: string;
	debugRaw?: unknown;
};

const SETTINGS_KEY = 'ai.pipeline.settings.v1';

const defaultSettings = (): AppSettings => ({
	script: { baseUrl: '', apiKey: '', model: '' },
	image: { baseUrl: '', apiKey: '', model: '' },
	video: { baseUrl: '', apiKey: '', model: '' },
	maxSegmentSeconds: 4,
	segmentsCount: 6,
	imageWidth: 1280,
	imageHeight: 720,
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const asNumber = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

const coerceSettings = (value: unknown): AppSettings => {
	const next = defaultSettings();
	if (!isRecord(value)) {
		return next;
	}

	const script = value.script;
	const image = value.image;
	const video = value.video;

	if (isRecord(script)) {
		next.script.baseUrl = asString(script.baseUrl) ?? next.script.baseUrl;
		next.script.apiKey = asString(script.apiKey) ?? next.script.apiKey;
		next.script.model = asString(script.model) ?? next.script.model;
	}
	if (isRecord(image)) {
		next.image.baseUrl = asString(image.baseUrl) ?? next.image.baseUrl;
		next.image.apiKey = asString(image.apiKey) ?? next.image.apiKey;
		next.image.model = asString(image.model) ?? next.image.model;
	}
	if (isRecord(video)) {
		next.video.baseUrl = asString(video.baseUrl) ?? next.video.baseUrl;
		next.video.apiKey = asString(video.apiKey) ?? next.video.apiKey;
		next.video.model = asString(video.model) ?? next.video.model;
	}

	const maxSegmentSeconds = asNumber(value.maxSegmentSeconds);
	if (typeof maxSegmentSeconds === 'number' && Number.isFinite(maxSegmentSeconds)) {
		next.maxSegmentSeconds = Math.max(1, maxSegmentSeconds);
	}
	const segmentsCount = asNumber(value.segmentsCount);
	if (typeof segmentsCount === 'number' && Number.isFinite(segmentsCount)) {
		next.segmentsCount = Math.max(1, Math.floor(segmentsCount));
	}
	const imageWidth = asNumber(value.imageWidth);
	if (typeof imageWidth === 'number' && Number.isFinite(imageWidth)) {
		next.imageWidth = Math.max(64, Math.floor(imageWidth));
	}
	const imageHeight = asNumber(value.imageHeight);
	if (typeof imageHeight === 'number' && Number.isFinite(imageHeight)) {
		next.imageHeight = Math.max(64, Math.floor(imageHeight));
	}

	return next;
};

const getStoryboardSegments = (storyboard: unknown): unknown[] => {
	if (!isRecord(storyboard)) {
		return [];
	}
	const segments = storyboard.segments;
	return Array.isArray(segments) ? segments : [];
};

const segmentToText = (segment: unknown) => {
	if (!isRecord(segment)) {
		return '';
	}
	const title = asString(segment.segment_title) ?? asString(segment.title) ?? '';
	const summary = asString(segment.segment_summary) ?? '';
	const duration = asNumber(segment.duration_s);
	const shots = Array.isArray(segment.shots) ? segment.shots : [];

	const shotLines = shots
		.map((s, i) => {
			if (!isRecord(s)) {
				return `- 镜头${i + 1}: (无效)`;
			}
			const d = asNumber(s.duration_s);
			const visual = asString(s.visual) ?? '';
			const camera = asString(s.camera) ?? '';
			const action = asString(s.action) ?? '';
			const dialogue = asString(s.dialogue) ?? '';
			return `- 镜头${i + 1}${d ? `（${d}s）` : ''}: ${visual}${camera ? ` | 镜头: ${camera}` : ''}${action ? ` | 动作: ${action}` : ''}${dialogue ? ` | 台词/旁白: ${dialogue}` : ''}`;
		})
		.join('\n');

	return [
		title ? `段落标题: ${title}` : undefined,
		summary ? `段落概述: ${summary}` : undefined,
		duration ? `目标时长: ${duration}s` : undefined,
		shotLines ? `分镜:\n${shotLines}` : undefined,
	]
		.filter(Boolean)
		.join('\n');
};

const getFirstFramePrompt = (storyboard: unknown, segmentIndex: number, ideaFallback: string) => {
	const segments = getStoryboardSegments(storyboard);
	const seg = segments[segmentIndex];
	if (isRecord(seg)) {
		const p = asString(seg.first_frame_prompt);
		if (p && p.trim()) {
			return p.trim();
		}
	}
	return ideaFallback.trim();
};

const getVideoPrompt = (storyboard: unknown, segmentIndex: number, ideaFallback: string) => {
	const segments = getStoryboardSegments(storyboard);
	const seg = segments[segmentIndex];
	if (isRecord(seg)) {
		const p = asString(seg.video_prompt);
		// If video_prompt exists (even if empty), treat it as explicit.
		if (p !== undefined) {
			return p.trim();
		}

		const asShotsText = segmentToText(seg);
		if (asShotsText.trim()) {
			return asShotsText;
		}
	}

	return ideaFallback.trim();
};

const getSegmentDuration = (storyboard: unknown, segmentIndex: number, fallback: number) => {
	const segments = getStoryboardSegments(storyboard);
	const seg = segments[segmentIndex];
	if (isRecord(seg)) {
		const d = asNumber(seg.duration_s);
		if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
			return d;
		}
	}
	return fallback;
};

const extractMarkdownImageUrls = (text: string): string[] => {
	// Matches: ![alt](url)
	const urls: string[] = [];
	const re = /!\[[^\]]*\]\(([^)\s]+)\)/g;
	for (const m of text.matchAll(re)) {
		const url = m[1];
		if (url) {
			urls.push(url);
		}
	}
	return urls;
};

const extractHttpUrls = (text: string): string[] => {
	const urls: string[] = [];
	const re = /https?:\/\/[^\s)\]]+/g;
	for (const m of text.matchAll(re)) {
		urls.push(m[0]);
	}
	return urls;
};

const filterByExt = (urls: string[], exts: string[]) => {
	const re = new RegExp(`\\.(${exts.map((e) => e.replace(/\./g, '')).join('|')})(?:\\?|#|$)`, 'i');
	return urls.filter((u) => re.test(u));
};

const extractVideoUrlsFromText = (text: string): string[] => {
	const urls = extractHttpUrls(text);
	const videoUrls = filterByExt(urls, ['mp4', 'webm', 'mov', 'm4v']);
	return videoUrls.length > 0 ? videoUrls : urls;
};

const extractImageUrlsFromText = (text: string): string[] => {
	const md = extractMarkdownImageUrls(text);
	const urls = [...md, ...extractHttpUrls(text)];
	const imageUrls = filterByExt(urls, ['png', 'jpg', 'jpeg', 'webp']);
	return imageUrls.length > 0 ? imageUrls : md;
};

const readFileAsDataUrl = (file: File): Promise<string> => {
	return new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new Error('读取文件失败'));
		reader.onload = () => resolve(String(reader.result));
		reader.readAsDataURL(file);
	});
};

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
	return (
		<div
			style={{
				background: PALETTE.panel,
				border: `1px solid ${PALETTE.border}`,
				borderRadius: 16,
				padding: 16,
			}}
		>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					marginBottom: 12,
				}}
			>
				<span style={{ fontSize: 14, letterSpacing: 0.3, color: PALETTE.muted }}>
					{title}
				</span>
			</div>
			{children}
		</div>
	);
};

const Button: React.FC<{
	label: string;
	onClick: () => void;
	disabled?: boolean;
	variant?: 'primary' | 'ghost' | 'danger';
}> = ({ label, onClick, disabled, variant = 'ghost' }) => {
	const bg =
		variant === 'primary'
			? `linear-gradient(135deg, ${PALETTE.accentA} 0%, ${PALETTE.accentB} 100%)`
			: variant === 'danger'
				? 'rgba(251,146,60,0.16)'
				: 'rgba(255,255,255,0.06)';

	const borderColor =
		variant === 'primary'
			? 'rgba(255,255,255,0.10)'
			: variant === 'danger'
				? 'rgba(251,146,60,0.26)'
				: 'rgba(255,255,255,0.10)';

	const color = variant === 'primary' ? 'rgba(8,10,12,0.90)' : PALETTE.text;

	return (
		<button
			onClick={onClick}
			disabled={disabled}
			style={{
				appearance: 'none',
				border: `1px solid ${borderColor}`,
				background: bg,
				color,
				padding: '10px 12px',
				borderRadius: 12,
				fontSize: 13,
				fontWeight: 650,
				letterSpacing: 0.2,
				cursor: disabled ? 'not-allowed' : 'pointer',
				opacity: disabled ? 0.5 : 1,
				transition: 'transform 120ms ease, filter 120ms ease',
			}}
		>
			{label}
		</button>
	);
};

const Field: React.FC<{
	label: string;
	children: React.ReactNode;
}> = ({ label, children }) => {
	return (
		<label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
			<span style={{ fontSize: 12, color: PALETTE.muted }}>{label}</span>
			{children}
		</label>
	);
};

const TextInput: React.FC<{
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	type?: 'text' | 'password';
}> = ({ value, onChange, placeholder, type = 'text' }) => {
	return (
		<input
			type={type}
			value={value}
			placeholder={placeholder}
			onChange={(e) => onChange(e.target.value)}
			style={{
				background: 'rgba(0,0,0,0.35)',
				border: `1px solid ${PALETTE.border}`,
				borderRadius: 12,
				padding: '10px 10px',
				color: PALETTE.text,
				fontSize: 13,
				outline: 'none',
			}}
		/>
	);
};

const NumberInput: React.FC<{
	value: number;
	onChange: (v: number) => void;
	min?: number;
	max?: number;
}> = ({ value, onChange, min, max }) => {
	return (
		<input
			type="number"
			value={String(value)}
			min={min}
			max={max}
			onChange={(e) => onChange(Number(e.target.value))}
			style={{
				background: 'rgba(0,0,0,0.35)',
				border: `1px solid ${PALETTE.border}`,
				borderRadius: 12,
				padding: '10px 10px',
				color: PALETTE.text,
				fontSize: 13,
				outline: 'none',
				width: '100%',
			}}
		/>
	);
};

const TextArea: React.FC<{
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	rows?: number;
 	readOnly?: boolean;
}> = ({ value, onChange, placeholder, rows = 6, readOnly }) => {
	return (
		<textarea
			value={value}
			placeholder={placeholder}
			rows={rows}
			readOnly={readOnly}
			onChange={(e) => {
				if (readOnly) {
					return;
				}
				onChange(e.target.value);
			}}
			style={{
				background: 'rgba(0,0,0,0.35)',
				border: `1px solid ${PALETTE.border}`,
				borderRadius: 12,
				padding: '10px 10px',
				color: PALETTE.text,
				fontSize: 13,
				outline: 'none',
				resize: 'vertical',
				width: '100%',
				fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
			}}
		/>
	);
};

const ModelEditor: React.FC<{
	label: string;
	value: ModelEndpointConfig;
	onChange: (next: ModelEndpointConfig) => void;
}> = ({ label, value, onChange }) => {
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
			<div style={{ fontSize: 13, fontWeight: 700, color: PALETTE.text }}>{label}</div>
			<div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
				<Field label="Base URL (可含 /v1)">
					<TextInput
						value={value.baseUrl}
						onChange={(v) => onChange({ ...value, baseUrl: v })}
						placeholder="https://example.com"
					/>
				</Field>
				<Field label="API Key">
					<TextInput
						value={value.apiKey}
						onChange={(v) => onChange({ ...value, apiKey: v })}
						type="password"
						placeholder="sk-..."
					/>
				</Field>
				<Field label="Model name">
					<TextInput
						value={value.model}
						onChange={(v) => onChange({ ...value, model: v })}
						placeholder="your-model"
					/>
				</Field>
			</div>
		</div>
	);
};

export const AIPipeline: React.FC = () => {
	const [settings, setSettings] = useState<AppSettings>(() => defaultSettings());
	const [idea, setIdea] = useState('');
	const [settingsImportText, setSettingsImportText] = useState('');
	const [showSettingsImport, setShowSettingsImport] = useState(false);
	const [segmentVideoPromptOverrides, setSegmentVideoPromptOverrides] = useState<Record<number, string>>({});

	const [storyboardText, setStoryboardText] = useState('');
	const [storyboardParsed, setStoryboardParsed] = useState<unknown>(null);
	const [storyboardError, setStoryboardError] = useState<string | null>(null);
	const [storyboardConfirmed, setStoryboardConfirmed] = useState(false);

	const [firstFrameSrc, setFirstFrameSrc] = useState<string | null>(null);
	const [firstFrameDebug, setFirstFrameDebug] = useState<unknown>(null);
	const [firstFrameConfirmed, setFirstFrameConfirmed] = useState(false);
	const [firstFrameUploadName, setFirstFrameUploadName] = useState<string | null>(null);

	const [segmentOutputs, setSegmentOutputs] = useState<SegmentOutput[]>([]);
	const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
	const [currentSeedImageSrc, setCurrentSeedImageSrc] = useState<string | null>(null);

	const [busy, setBusy] = useState<null | 'storyboard' | 'firstFrame' | 'video' | 'extractFrame'>(null);
	const [error, setError] = useState<string | null>(null);

	const objectUrlsToRevoke = useRef<string[]>([]);
	const firstFrameUploadInputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		try {
			const raw = window.localStorage.getItem(SETTINGS_KEY);
			if (!raw) {
				return;
			}
			const parsed = JSON.parse(raw) as unknown;
			setSettings(coerceSettings(parsed));
		} catch {
			// ignore
		}
	}, []);

	useEffect(() => {
		try {
			window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
		} catch {
			// ignore
		}
	}, [settings]);

	const settingsExportText = useMemo(() => {
		return JSON.stringify(settings, null, 2);
	}, [settings]);

	const copySettingsExport = async () => {
		setError(null);
		try {
			await navigator.clipboard.writeText(settingsExportText);
		} catch {
			setError('复制失败：浏览器可能未授予剪贴板权限。你可以展开“导入配置”，在导出框里手动全选复制。');
		}
	};

	const importSettingsFromText = () => {
		setError(null);
		try {
			const parsed = JSON.parse(settingsImportText) as unknown;
			setSettings(coerceSettings(parsed));
			setShowSettingsImport(false);
			setSettingsImportText('');
		} catch (err) {
			setError(`导入失败：${err instanceof Error ? err.message : String(err)}`);
		}
	};

	const clearSavedSettings = () => {
		setError(null);
		try {
			window.localStorage.removeItem(SETTINGS_KEY);
		} catch {
			// ignore
		}
		setSettings(defaultSettings());
		setShowSettingsImport(false);
		setSettingsImportText('');
	};

	useEffect(() => {
		return () => {
			for (const u of objectUrlsToRevoke.current) {
				try {
					URL.revokeObjectURL(u);
				} catch {
					// ignore
				}
			}
		};
	}, []);

	const segments = useMemo(() => getStoryboardSegments(storyboardParsed), [storyboardParsed]);
	const storyboardValid = storyboardError === null && !!storyboardParsed && segments.length > 0;

	const resetAfterStoryboardChange = () => {
		setStoryboardConfirmed(false);
		setFirstFrameSrc(null);
		setFirstFrameConfirmed(false);
		setFirstFrameDebug(null);
		setFirstFrameUploadName(null);
		setSegmentOutputs([]);
		setCurrentSegmentIndex(0);
		setCurrentSeedImageSrc(null);
		setSegmentVideoPromptOverrides({});
	};

	const parseStoryboardText = (text: string) => {
		setStoryboardText(text);
		setError(null);

		if (!text.trim()) {
			setStoryboardParsed(null);
			setStoryboardError(null);
			resetAfterStoryboardChange();
			return;
		}
		try {
			const parsed = JSON.parse(text) as unknown;
			setStoryboardParsed(parsed);
			setStoryboardError(null);
			resetAfterStoryboardChange();
		} catch (err) {
			setStoryboardParsed(null);
			setStoryboardError(err instanceof Error ? err.message : String(err));
			resetAfterStoryboardChange();
		}
	};

	const generateStoryboard = async () => {
		setError(null);
		setBusy('storyboard');
		try {
			const maxS = settings.maxSegmentSeconds;
			const segmentsCount = settings.segmentsCount;
			const system =
				'你是资深分镜编剧。你必须只输出严格 JSON，不要输出任何额外文本。' +
				'\n输出结构要求：' +
				'\n{' +
				'\n  "title": string,' +
				'\n  "style": {"overall": string, "characters": string, "camera": string, "lighting": string},' +
				'\n  "segments": [' +
				'\n    {' +
				'\n      "segment_index": number,' +
				'\n      "segment_title": string,' +
				'\n      "segment_summary": string,' +
				'\n      "duration_s": number,' +
				'\n      "first_frame_prompt": string,' +
				'\n      "video_prompt": string,' +
				'\n      "shots": [' +
				'\n        {"shot_index": number, "duration_s": number, "visual": string, "camera": string, "action": string, "dialogue": string}' +
				'\n      ]' +
				'\n    }' +
				'\n  ]' +
				'\n}' +
				'\n硬性约束：每个 segment 的 duration_s 不能超过用户给定的单段最大时长；每个 segment 至少包含 1 个镜头；shot 的 duration_s 合计应接近 segment duration_s。' +
				'\n语言：全部使用中文。画面提示词 first_frame_prompt / video_prompt 需要适合后续“首帧图生视频”，且保持角色/场景一致性。';

			const user =
				`用户想法：${idea.trim() || '（空）'}\n` +
				`单段最大视频时长：${maxS}s\n` +
				`建议段落数：${segmentsCount}\n` +
				'要求：尽量让每段剧情是一个相对完整的小事件（不要把整段故事一次做完），段与段之间要能自然衔接。';

			const { json } = await callChatCompletionsForJson(settings.script, {
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: user },
				],
				temperature: 0.6,
				response_format: { type: 'json_object' },
			});

			const pretty = JSON.stringify(json, null, 2);
			setStoryboardParsed(json);
			setStoryboardError(null);
			setStoryboardText(pretty);
			resetAfterStoryboardChange();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(null);
		}
	};

	const confirmStoryboard = () => {
		setError(null);
		if (!storyboardValid) {
			setError('分镜 JSON 无效或缺少 segments');
			return;
		}
		setStoryboardConfirmed(true);
		setCurrentSegmentIndex(0);
		setSegmentOutputs([]);
		setFirstFrameConfirmed(false);
		setCurrentSeedImageSrc(null);
	};

	const unconfirmStoryboard = () => {
		setStoryboardConfirmed(false);
		setFirstFrameSrc(null);
		setFirstFrameConfirmed(false);
		setFirstFrameUploadName(null);
		setSegmentOutputs([]);
		setCurrentSegmentIndex(0);
		setCurrentSeedImageSrc(null);
	};

	const generateFirstFrame = async () => {
		setError(null);
		if (!storyboardConfirmed) {
			setError('请先确认分镜');
			return;
		}
		setBusy('firstFrame');
		try {
			const prompt = getFirstFramePrompt(storyboardParsed, 0, idea);
			const system =
				'你是一个图像生成服务（通过 /v1/chat/completions 调用）。你必须只输出严格 JSON，不要输出任何额外文本。' +
				'\n输出格式（两种任选其一）：' +
				'\n1) {"mime_type":"image/png","image_base64":"..."}' +
				'\n2) {"mime_type":"image/png","image_url":"https://..."}' +
				'\n建议：优先返回 image_url（避免 base64 过大）。' +
				'\n要求：生成 16:9 的首帧画面，清晰、无水印、无文字叠加。';

			const user =
				`首帧提示词：${prompt}\n` +
				`尺寸：${settings.imageWidth}x${settings.imageHeight}（16:9）\n` +
				'请确保角色、场景、服装、色调稳定，作为后续图生视频的起始帧。';

			const { rawResponse, contentText } = await callChatCompletionsForText(settings.image, {
				messages: [
					{ role: 'system', content: system },
					{ role: 'user', content: user },
				],
				temperature: 0.2,
			});

			setFirstFrameDebug(rawResponse);

			// 1) Prefer strict JSON (some providers support it)
			try {
				const json = parseJsonFromModelText(contentText);
				if (isRecord(json)) {
					const mime = asString(json.mime_type) ?? 'image/png';
					const base64 = asString(json.image_base64);
					const url = asString(json.image_url);
					if (base64 && base64.trim()) {
						setFirstFrameUploadName(null);
						setFirstFrameSrc(asDataUrlFromBase64(base64.trim(), mime));
						setFirstFrameConfirmed(false);
						setCurrentSeedImageSrc(null);
						return;
					}
					if (url && url.trim()) {
						setFirstFrameUploadName(null);
						setFirstFrameSrc(url.trim());
						setFirstFrameConfirmed(false);
						setCurrentSeedImageSrc(null);
						return;
					}
				}
			} catch {
				// fallthrough
			}

			// 2) Many image models return Markdown like: ![image](https://...)
			const mdUrls = extractMarkdownImageUrls(contentText);
			if (mdUrls.length > 0) {
				const chosen = mdUrls[mdUrls.length - 1];
				setFirstFrameUploadName(null);
				setFirstFrameSrc(chosen);
				setFirstFrameConfirmed(false);
				setCurrentSeedImageSrc(null);
				return;
			}

			// 3) Fallback: any http(s) URL
			const httpUrls = extractHttpUrls(contentText);
			if (httpUrls.length > 0) {
				const chosen = httpUrls[httpUrls.length - 1];
				setFirstFrameUploadName(null);
				setFirstFrameSrc(chosen);
				setFirstFrameConfirmed(false);
				setCurrentSeedImageSrc(null);
				return;
			}

			throw new Error(
				`首帧输出无法解析为图片。模型输出内容：\n${contentText.length > 800 ? `${contentText.slice(0, 800)}...` : contentText}`
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(null);
		}
	};

	const uploadFirstFrameFromFile = async (file: File) => {
		setError(null);
		if (!storyboardConfirmed) {
			setError('请先确认分镜');
			return;
		}
		if (!file.type || !file.type.startsWith('image/')) {
			setError('请选择图片文件（image/*）');
			return;
		}
		setBusy('firstFrame');
		try {
			const dataUrl = await readFileAsDataUrl(file);
			setFirstFrameUploadName(file.name);
			setFirstFrameDebug({
				source: 'upload',
				fileName: file.name,
				size: file.size,
				type: file.type,
			});
			setFirstFrameSrc(dataUrl);
			setFirstFrameConfirmed(false);
			setCurrentSeedImageSrc(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(null);
		}
	};

	const confirmFirstFrame = () => {
		setError(null);
		if (!firstFrameSrc) {
			setError('请先生成或上传首帧');
			return;
		}
		setFirstFrameConfirmed(true);
		setCurrentSeedImageSrc(firstFrameSrc);
		setSegmentOutputs([]);
		setCurrentSegmentIndex(0);
	};

	const unconfirmFirstFrame = () => {
		setFirstFrameConfirmed(false);
		setCurrentSeedImageSrc(null);
		setSegmentOutputs([]);
		setCurrentSegmentIndex(0);
	};

	const generateCurrentSegmentVideo = async () => {
		setError(null);
		if (!storyboardConfirmed) {
			setError('请先确认分镜');
			return;
		}
		if (!firstFrameConfirmed || !currentSeedImageSrc) {
			setError('请先确认首帧（或为当前段准备 seed 图片）');
			return;
		}
		if (currentSegmentIndex >= segments.length) {
			setError('所有段落已生成完');
			return;
		}
		setBusy('video');
		try {
			const durationS = getSegmentDuration(
				storyboardParsed,
				currentSegmentIndex,
				settings.maxSegmentSeconds
			);
			const computedPrompt = getVideoPrompt(storyboardParsed, currentSegmentIndex, idea);
			const overridePrompt = segmentVideoPromptOverrides[currentSegmentIndex];
			const videoPrompt = overridePrompt && overridePrompt.trim() ? overridePrompt.trim() : computedPrompt;

			const system =
				'你是一个图生视频生成服务（通过 /v1/chat/completions 调用）。' +
				'\n你可以输出进度文本（可选），但最终必须输出“可下载/可访问”的视频链接。' +
				'\n优先输出 JSON（严格 JSON，不要代码块、不加额外文本）：' +
				'\n1) {"mime_type":"video/mp4","video_url":"https://...", "last_frame_url":"https://..."}' +
				'\n2) {"mime_type":"video/mp4","video_base64":"...", "last_frame_base64":"...", "last_frame_mime_type":"image/png"}' +
				'\n如果无法输出 JSON，则至少在最后单独一行输出 video_url（http/https）。' +
				'\n要求：必须以输入图片作为第一帧/参考，生成连续视频；尽量保持角色与场景一致；无水印、无文字叠加。';

			const userText =
				`当前是第 ${currentSegmentIndex + 1} 段（共 ${segments.length} 段）。\n` +
				`目标时长：${durationS}s（不要超过）。\n` +
				`剧情分镜/动作要求：\n${videoPrompt}\n\n` +
				'请严格根据时长限制调整节奏：只表现这一段剧情，不要尝试一次讲完所有后续剧情。' +
				'\n如果可以，请同时返回视频最后一帧（last_frame_*）用于下一段的 seed。';

			const { rawResponse, contentText } = await callChatCompletionsForText(settings.video, {
				messages: [
					{ role: 'system', content: system },
					{
						role: 'user',
						content: [
							{ type: 'text', text: userText },
							{ type: 'image_url', image_url: { url: currentSeedImageSrc } },
						],
					},
				],
				temperature: 0.2,
			});

			let parsedJson: unknown | null = null;
			try {
				parsedJson = parseJsonFromModelText(contentText);
			} catch {
				parsedJson = null;
			}

			let videoMime = 'video/mp4';
			let videoSrc: string | undefined;
			let lastFrameSrc: string | undefined;

			if (parsedJson && isRecord(parsedJson)) {
				videoMime = asString(parsedJson.mime_type) ?? videoMime;
				const videoBase64 = asString(parsedJson.video_base64);
				const videoUrl = asString(parsedJson.video_url);

				if (videoBase64 && videoBase64.trim()) {
					videoSrc = await base64ToObjectUrl(videoBase64.trim(), videoMime);
					objectUrlsToRevoke.current.push(videoSrc);
				} else if (videoUrl && videoUrl.trim()) {
					videoSrc = videoUrl.trim();
				}

				const lastFrameBase64 = asString(parsedJson.last_frame_base64);
				const lastFrameMime = asString(parsedJson.last_frame_mime_type) ?? 'image/png';
				const lastFrameUrl = asString(parsedJson.last_frame_url);
				if (lastFrameBase64 && lastFrameBase64.trim()) {
					lastFrameSrc = asDataUrlFromBase64(lastFrameBase64.trim(), lastFrameMime);
				} else if (lastFrameUrl && lastFrameUrl.trim()) {
					lastFrameSrc = lastFrameUrl.trim();
				}
			}

			// Text-mode fallback (common for streaming providers)
			if (!videoSrc) {
				const urls = extractVideoUrlsFromText(contentText);
				let candidate: string | undefined;
				for (let i = urls.length - 1; i >= 0; i--) {
					const u = urls[i];
					if (u && (u.startsWith('http://') || u.startsWith('https://')) && !u.includes('...')) {
						candidate = u;
						break;
					}
				}
				if (candidate) {
					videoSrc = candidate;
					if (/\.webm(?:\?|#|$)/i.test(candidate)) {
						videoMime = 'video/webm';
					}
				}
			}

			if (!lastFrameSrc) {
				const imageUrls = extractImageUrlsFromText(contentText);
				let candidate: string | undefined;
				for (let i = imageUrls.length - 1; i >= 0; i--) {
					const u = imageUrls[i];
					if (u && (u.startsWith('http://') || u.startsWith('https://')) && !u.includes('...')) {
						candidate = u;
						break;
					}
				}
				if (candidate) {
					lastFrameSrc = candidate;
				}
			}

			if (!videoSrc) {
				throw new Error(
					`无法从模型输出中提取视频链接。模型输出内容：\n${contentText.length > 1200 ? `${contentText.slice(0, 1200)}...` : contentText}`
				);
			}

			const output: SegmentOutput = {
				segmentIndex: currentSegmentIndex,
				seedImageSrc: currentSeedImageSrc,
				videoSrc,
				videoMimeType: videoMime,
				lastFrameSrc,
				debugRaw: rawResponse,
			};

			setSegmentOutputs((prev) => {
				const filtered = prev.filter((p) => p.segmentIndex !== currentSegmentIndex);
				return [...filtered, output].sort((a, b) => a.segmentIndex - b.segmentIndex);
			});

			// Auto-extract last frame if provider didn't supply one.
			if (!lastFrameSrc) {
				setBusy('extractFrame');
				try {
					const extracted = await extractLastFrameAsDataUrl(videoSrc);
					setSegmentOutputs((prev) =>
						prev.map((s) =>
							s.segmentIndex === currentSegmentIndex ? { ...s, lastFrameSrc: extracted } : s
						)
					);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					setError(
						`已生成视频，但抽取最后一帧失败：${message}\n\n建议：让视频模型返回 last_frame_url/last_frame_base64，或确保视频链接允许 CORS。`
					);
				}
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(null);
		}
	};

	const addNewSegmentAfterLast = async () => {
		setError(null);
		if (!storyboardConfirmed) {
			setError('请先确认分镜');
			return;
		}
		const current = segmentOutputs.find((s) => s.segmentIndex === currentSegmentIndex);
		if (!current?.videoSrc) {
			setError('请先生成本段视频');
			return;
		}
		if (currentSegmentIndex + 1 < segments.length) {
			setError('仅支持在最后一段新增段落（请先切换到最后一段）');
			return;
		}
		if (!isRecord(storyboardParsed)) {
			setError('分镜 JSON 无效或缺少 segments');
			return;
		}
		const segs = storyboardParsed.segments;
		if (!Array.isArray(segs)) {
			setError('分镜 JSON 无效或缺少 segments');
			return;
		}

		setBusy('extractFrame');
		try {
			let lastFrame = current.lastFrameSrc;
			if (!lastFrame) {
				lastFrame = await extractLastFrameAsDataUrl(current.videoSrc);
			}
			setSegmentOutputs((prev) =>
				prev.map((s) => (s.segmentIndex === currentSegmentIndex ? { ...s, lastFrameSrc: lastFrame } : s))
			);

			const nextSegmentIndex = segs.length;
			const newSeg = {
				segment_index: nextSegmentIndex + 1,
				segment_title: `新增段落 ${nextSegmentIndex + 1}`,
				segment_summary: '',
				duration_s: settings.maxSegmentSeconds,
				first_frame_prompt: '',
				video_prompt: '',
				shots: [],
			};
			const nextStoryboard = { ...storyboardParsed, segments: [...segs, newSeg] };
			setStoryboardParsed(nextStoryboard);
			setStoryboardText(JSON.stringify(nextStoryboard, null, 2));

			setCurrentSegmentIndex(nextSegmentIndex);
			setCurrentSeedImageSrc(lastFrame);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(null);
		}
	};

	const extractAndUseLastFrameForNext = async () => {
		setError(null);
		const current = segmentOutputs.find((s) => s.segmentIndex === currentSegmentIndex);
		if (!current?.videoSrc) {
			setError('请先生成本段视频');
			return;
		}
		if (currentSegmentIndex + 1 >= segments.length) {
			setError('已经是最后一段');
			return;
		}

		setBusy('extractFrame');
		try {
			let lastFrame = current.lastFrameSrc;
			if (!lastFrame) {
				lastFrame = await extractLastFrameAsDataUrl(current.videoSrc);
			}

			setSegmentOutputs((prev) =>
				prev.map((s) => (s.segmentIndex === currentSegmentIndex ? { ...s, lastFrameSrc: lastFrame } : s))
			);
			setCurrentSegmentIndex((i) => i + 1);
			setCurrentSeedImageSrc(lastFrame);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(null);
		}
	};

	const goToSegment = (index: number) => {
		setError(null);
		if (index < 0 || index >= segments.length) {
			return;
		}
		setCurrentSegmentIndex(index);
		const existing = segmentOutputs.find((s) => s.segmentIndex === index);
		if (existing?.seedImageSrc) {
			setCurrentSeedImageSrc(existing.seedImageSrc);
			return;
		}

		if (index === 0) {
			setCurrentSeedImageSrc(firstFrameConfirmed ? firstFrameSrc : null);
			return;
		}
		const prev = segmentOutputs.find((s) => s.segmentIndex === index - 1);
		setCurrentSeedImageSrc(prev?.lastFrameSrc ?? null);
	};

	const canGenerateStoryboard = !!settings.script.baseUrl.trim() && !!settings.script.model.trim();
	const canGenerateFirstFrame =
		storyboardConfirmed && !!settings.image.baseUrl.trim() && !!settings.image.model.trim();
	const canGenerateVideo =
		storyboardConfirmed &&
		firstFrameConfirmed &&
		!!currentSeedImageSrc &&
		!!settings.video.baseUrl.trim() &&
		!!settings.video.model.trim();

	const currentOutput = segmentOutputs.find((s) => s.segmentIndex === currentSegmentIndex);
	const computedVideoPrompt = getVideoPrompt(storyboardParsed, currentSegmentIndex, idea);
	const currentPromptOverride = segmentVideoPromptOverrides[currentSegmentIndex];
	const videoPromptDraft = currentPromptOverride ?? computedVideoPrompt;
	const hasPromptOverride = currentPromptOverride !== undefined;

	const copyCurrentVideoLink = async () => {
		setError(null);
		const link = currentOutput?.videoSrc;
		if (!link) {
			setError('当前没有可复制的视频链接');
			return;
		}
		try {
			await navigator.clipboard.writeText(link);
		} catch {
			setError('复制失败：浏览器可能未授予剪贴板权限。你也可以手动全选复制链接文本。');
		}
	};

	const openCurrentVideoLink = () => {
		setError(null);
		const link = currentOutput?.videoSrc;
		if (!link) {
			setError('当前没有可打开的视频链接');
			return;
		}
		try {
			window.open(link, '_blank', 'noopener,noreferrer');
		} catch {
			setError('打开失败：浏览器阻止了弹窗或链接无效');
		}
	};

	const mergeClips = useMemo(() => {
		return segmentOutputs
			.filter((s) => typeof s.videoSrc === 'string' && s.videoSrc.trim())
			.map((s) => ({
				src: s.videoSrc as string,
				duration_s: getSegmentDuration(storyboardParsed, s.segmentIndex, settings.maxSegmentSeconds),
			}));
	}, [segmentOutputs, storyboardParsed, settings.maxSegmentSeconds]);

	const mergeBlobCount = useMemo(() => {
		return mergeClips.filter((c) => c.src.startsWith('blob:')).length;
	}, [mergeClips]);

	const mergePropsText = useMemo(() => {
		return JSON.stringify(
			{
				clips: mergeClips,
				backgroundColor: 'black',
				fit: 'cover',
			},
			null,
			2
		);
	}, [mergeClips]);

	const copyMergeProps = async () => {
		setError(null);
		try {
			await navigator.clipboard.writeText(mergePropsText);
		} catch {
			setError('复制失败：浏览器可能未授予剪贴板权限。你也可以手动全选复制文本框内容。');
		}
	};

	return (
		<div
			style={{
				background: `linear-gradient(180deg, ${PALETTE.bg1} 0%, ${PALETTE.bg0} 75%)`,
				color: PALETTE.text,
				fontFamily:
					'System, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
				padding: 24,
				minHeight: '100vh',
				display: 'flex',
			}}
		>
			<div
				style={{
					display: 'grid',
					gridTemplateColumns: '420px 1fr',
					gap: 18,
					flex: 1,
					minHeight: 0,
				}}
			>
				<div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
					<Panel title="模型配置（3 个）">
						<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
							<ModelEditor
								label="1) 剧本/分镜模型"
								value={settings.script}
								onChange={(next) => setSettings((s) => ({ ...s, script: next }))}
							/>
							<div style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />
							<ModelEditor
								label="2) 首帧文生图模型"
								value={settings.image}
								onChange={(next) => setSettings((s) => ({ ...s, image: next }))}
							/>
							<div style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />
							<ModelEditor
								label="3) 图生视频模型"
								value={settings.video}
								onChange={(next) => setSettings((s) => ({ ...s, video: next }))}
							/>

							<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
								<Button
									label="复制配置"
									onClick={copySettingsExport}
									disabled={busy !== null}
									variant="ghost"
								/>
								<Button
									label={showSettingsImport ? '收起导入' : '导入配置'}
									onClick={() => {
										setError(null);
										setShowSettingsImport((v) => !v);
									}}
									disabled={busy !== null}
									variant="ghost"
								/>
								<Button
									label="清空配置"
									onClick={clearSavedSettings}
									disabled={busy !== null}
									variant="danger"
								/>
							</div>

							<div style={{ fontSize: 12, color: PALETTE.muted, lineHeight: 1.5 }}>
								模型的 URL / Key / Model name 会自动保存到本地（localStorage），刷新页面无需重填。
							</div>

								{showSettingsImport ? (
									<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
										<Field label="导出（包含 Key，可手动复制）">
											<TextArea value={settingsExportText} onChange={() => {}} rows={7} readOnly />
										</Field>
										<div style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />
										<Field label="导入（粘贴 JSON）">
										<TextArea
											value={settingsImportText}
											onChange={setSettingsImportText}
											placeholder="粘贴配置 JSON（包含 script/image/video 三个模型配置）"
											rows={7}
										/>
										</Field>
										<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
											<Button
												label="导入并保存"
												onClick={importSettingsFromText}
												disabled={busy !== null || !settingsImportText.trim()}
												variant="primary"
											/>
											<Button
												label="取消"
												onClick={() => {
												setShowSettingsImport(false);
												setSettingsImportText('');
											}}
												disabled={busy !== null}
												variant="ghost"
											/>
										</div>
									</div>
								) : null}
						</div>
					</Panel>

					<Panel title="生成参数">
						<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
							<Field label="单段最大视频时长（秒）">
								<NumberInput
									value={settings.maxSegmentSeconds}
									onChange={(v) => setSettings((s) => ({ ...s, maxSegmentSeconds: Math.max(1, v || 1) }))}
									min={1}
									max={30}
								/>
							</Field>
							<Field label="建议段落数">
								<NumberInput
									value={settings.segmentsCount}
									onChange={(v) => setSettings((s) => ({ ...s, segmentsCount: Math.max(1, v || 1) }))}
									min={1}
									max={50}
								/>
							</Field>
							<Field label="首帧宽度">
								<NumberInput
									value={settings.imageWidth}
									onChange={(v) =>
										setSettings((s) => ({ ...s, imageWidth: Math.max(64, v || 64) }))
									}
									min={64}
									max={4096}
								/>
							</Field>
							<Field label="首帧高度">
								<NumberInput
									value={settings.imageHeight}
									onChange={(v) =>
										setSettings((s) => ({ ...s, imageHeight: Math.max(64, v || 64) }))
									}
									min={64}
									max={4096}
								/>
							</Field>
						</div>
					</Panel>
				</div>

				<div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
					<Panel title="1) 用户想法 → AI 分镜">
						<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
							<Field label="想法（越具体越好）">
								<TextArea
									value={idea}
									onChange={(v) => setIdea(v)}
									placeholder="例如：一个雨夜的侦探在霓虹灯下追查线索，风格偏电影感..."
									rows={5}
								/>
							</Field>
							<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
								<Button
									label={busy === 'storyboard' ? '生成分镜中...' : '生成分镜（AI）'}
									onClick={generateStoryboard}
									disabled={!canGenerateStoryboard || busy !== null}
									variant="primary"
								/>
								<Button
									label="清空分镜"
									onClick={() => parseStoryboardText('')}
									disabled={busy !== null}
									variant="ghost"
								/>
							</div>
							<div style={{ fontSize: 12, color: PALETTE.muted, lineHeight: 1.5 }}>
								接口：使用你配置的 `Base URL + /v1/chat/completions`。分镜会按“单段最大时长”拆成多个段落，后续每次只生成一段视频。
							</div>
						</div>
					</Panel>

					<Panel title="2) 分镜（JSON，可手动编辑 / 可让 AI 重新生成）">
						<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
							<TextArea
								value={storyboardText}
								onChange={parseStoryboardText}
								placeholder="这里会显示分镜 JSON。你也可以手动修改后再确认。"
								rows={12}
							/>
							{storyboardError ? (
								<div style={{ fontSize: 12, color: PALETTE.danger, whiteSpace: 'pre-wrap' }}>
									JSON 解析错误：{storyboardError}
								</div>
							) : null}
							<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
								{!storyboardConfirmed ? (
									<Button
										label="确认分镜"
										onClick={confirmStoryboard}
										disabled={!storyboardValid || busy !== null}
										variant="primary"
									/>
								) : (
									<Button
										label="取消确认（继续编辑）"
										onClick={unconfirmStoryboard}
										disabled={busy !== null}
										variant="ghost"
									/>
								)}
								<Button
									label="AI 重新生成分镜"
									onClick={generateStoryboard}
									disabled={!canGenerateStoryboard || busy !== null}
									variant="ghost"
								/>
							</div>
							<div style={{ fontSize: 12, color: PALETTE.muted }}>
								当前段落数：{segments.length}
								{storyboardConfirmed ? `（已确认）` : ''}
							</div>
						</div>
					</Panel>

					<Panel title="3) 生成首帧（文生图）→ 用户确认">
						<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
							<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
								<Button
									label={busy === 'firstFrame' ? '生成首帧中...' : '生成首帧'}
									onClick={generateFirstFrame}
									disabled={!canGenerateFirstFrame || busy !== null}
									variant="primary"
								/>
								<Button
									label="上传首帧"
									onClick={() => firstFrameUploadInputRef.current?.click()}
									disabled={!storyboardConfirmed || busy !== null}
									variant="ghost"
								/>
								<input
									ref={firstFrameUploadInputRef}
									type="file"
									accept="image/*"
									style={{ display: 'none' }}
									onChange={(e) => {
										const input = e.currentTarget;
										const file = input.files?.[0];
										input.value = '';
										if (!file) {
											return;
										}
										void uploadFirstFrameFromFile(file);
									}}
								/>
								{!firstFrameConfirmed ? (
									<Button
										label="确认首帧"
										onClick={confirmFirstFrame}
										disabled={!firstFrameSrc || busy !== null}
										variant="ghost"
									/>
								) : (
									<Button
										label="取消确认"
										onClick={unconfirmFirstFrame}
										disabled={busy !== null}
										variant="ghost"
									/>
								)}
							</div>

							{firstFrameSrc ? (
								<div
									style={{
										borderRadius: 14,
										overflow: 'hidden',
										border: `1px solid ${PALETTE.border}`,
										background: 'rgba(0,0,0,0.25)',
									}}
								>
									<img
										src={firstFrameSrc}
										style={{ width: '100%', height: 'auto', display: 'block' }}
									/>
								</div>
							) : (
								<div style={{ fontSize: 12, color: PALETTE.muted }}>
									尚未生成首帧。
								</div>
							)}
							{firstFrameUploadName ? (
								<div style={{ fontSize: 12, color: PALETTE.muted }}>
									已上传：{firstFrameUploadName}
								</div>
							) : null}
							<div style={{ fontSize: 12, color: PALETTE.muted }}>
								首帧用于第 1 段视频的 seed。后续段默认使用“上一段视频的最后一帧”继续生成。
							</div>
						</div>
					</Panel>

					<Panel title="4) 分段图生视频（每次只生成一段）">
						<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
							<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
								<span style={{ fontSize: 13, color: PALETTE.text }}>
									当前段：{segments.length ? currentSegmentIndex + 1 : 0}/{segments.length}
								</span>
								<Button
									label={busy === 'video' ? '生成视频中...' : '生成本段视频'}
									onClick={generateCurrentSegmentVideo}
									disabled={!canGenerateVideo || busy !== null}
									variant="primary"
								/>
								<Button
									label={busy === 'extractFrame' ? '提取最后一帧中...' : '用最后一帧进入下一段'}
									onClick={extractAndUseLastFrameForNext}
									disabled={busy !== null || !currentOutput?.videoSrc || currentSegmentIndex + 1 >= segments.length}
									variant="ghost"
								/>
								<Button
									label={busy === 'extractFrame' ? '新增段落中...' : '新增段落'}
									onClick={addNewSegmentAfterLast}
									disabled={
										busy !== null ||
										!currentOutput?.videoSrc ||
										segments.length === 0 ||
										currentSegmentIndex + 1 < segments.length
									}
									variant="ghost"
								/>
							</div>

							{segments.length ? (
								<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
									{segments.map((_, i) => {
										const done = segmentOutputs.some((s) => s.segmentIndex === i && !!s.videoSrc);
										const active = i === currentSegmentIndex;
										return (
											<button
												key={i}
												onClick={() => goToSegment(i)}
												disabled={busy !== null}
												style={{
													appearance: 'none',
													border: `1px solid ${active ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.10)'}`,
													background: active
														? 'rgba(255,255,255,0.10)'
														: 'rgba(255,255,255,0.06)',
													color: done ? PALETTE.ok : PALETTE.text,
													borderRadius: 999,
													padding: '8px 10px',
													fontSize: 12,
													cursor: busy !== null ? 'not-allowed' : 'pointer',
													opacity: busy !== null ? 0.6 : 1,
												}}
											>
												段 {i + 1}
											</button>
										);
									})}
								</div>
							) : null}

							<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
								<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
									<div style={{ fontSize: 12, color: PALETTE.muted }}>当前段 seed 图片</div>
									<div
										style={{
											borderRadius: 14,
											overflow: 'hidden',
											border: `1px solid ${PALETTE.border}`,
											background: 'rgba(0,0,0,0.25)',
											minHeight: 120,
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'center',
										}}
									>
										{currentSeedImageSrc ? (
											<img
												src={currentSeedImageSrc}
												style={{ width: '100%', height: 'auto', display: 'block' }}
											/>
										) : (
											<span style={{ fontSize: 12, color: PALETTE.muted }}>无</span>
										)}
									</div>
								</div>

								<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
									<div style={{ fontSize: 12, color: PALETTE.muted }}>本段视频预览</div>
									<div
										style={{
											borderRadius: 14,
											overflow: 'hidden',
											border: `1px solid ${PALETTE.border}`,
											background: 'rgba(0,0,0,0.25)',
											minHeight: 120,
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'center',
										}}
									>
										{currentOutput?.videoSrc ? (
											<video
												src={currentOutput.videoSrc}
												controls
												style={{ width: '100%', height: 'auto', display: 'block' }}
											/>
										) : (
											<span style={{ fontSize: 12, color: PALETTE.muted }}>未生成</span>
										)}
									</div>
								</div>
							</div>

							{currentOutput?.videoSrc ? (
								<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
									<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
										<Button
											label="复制视频链接"
											onClick={copyCurrentVideoLink}
											disabled={busy !== null}
											variant="ghost"
										/>
										<Button
											label="打开视频链接"
											onClick={openCurrentVideoLink}
											disabled={busy !== null}
											variant="ghost"
										/>
									</div>
									<TextArea value={currentOutput.videoSrc} onChange={() => {}} rows={2} readOnly />
								</div>
							) : null}

							{currentOutput?.lastFrameSrc ? (
								<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
									<div style={{ fontSize: 12, color: PALETTE.muted }}>
										{currentSegmentIndex + 1 < segments.length
											? '本段最后一帧（将作为下一段 seed）'
											: '本段最后一帧（可作为新增段落 seed）'}
									</div>
									<div
										style={{
											borderRadius: 14,
											overflow: 'hidden',
											border: `1px solid ${PALETTE.border}`,
											background: 'rgba(0,0,0,0.25)',
										}}
									>
										<img
											src={currentOutput.lastFrameSrc}
											style={{ width: '100%', height: 'auto', display: 'block' }}
										/>
									</div>
								</div>
							) : null}
							<Field label="本段视频 Prompt（可编辑，重新生成会使用）">
								<TextArea
									value={videoPromptDraft}
									onChange={(v) => {
										setSegmentVideoPromptOverrides((prev) => {
											const trimmed = v.trim();
											if (!trimmed) {
												if (prev[currentSegmentIndex] === undefined) {
													return prev;
												}
												const next = { ...prev };
												delete next[currentSegmentIndex];
												return next;
											}
											return { ...prev, [currentSegmentIndex]: v };
										});
									}}
									rows={8}
								/>
							</Field>
							<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
								<Button
									label="重置为分镜推荐"
									onClick={() => {
										setSegmentVideoPromptOverrides((prev) => {
											if (prev[currentSegmentIndex] === undefined) {
												return prev;
											}
											const next = { ...prev };
											delete next[currentSegmentIndex];
											return next;
										});
									}}
									disabled={busy !== null || !hasPromptOverride}
									variant="ghost"
								/>
								<span style={{ fontSize: 12, color: PALETTE.muted }}>
									{hasPromptOverride ? '已使用自定义 Prompt' : '使用分镜推荐 Prompt'}
								</span>
							</div>
						</div>
					</Panel>

					<Panel title="5) 导出合并清单（Remotion）">
						<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
							<div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
								<Button
									label="复制合并 JSON"
									onClick={copyMergeProps}
									disabled={busy !== null || mergeClips.length === 0}
									variant="ghost"
								/>
							</div>
							<TextArea value={mergePropsText} onChange={() => {}} rows={8} readOnly />
							<div style={{ fontSize: 12, color: PALETTE.muted, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
								推荐用法：把上面的 JSON 保存为 `merge-props.json`，然后运行 `npm run merge:local`（会顺序下载所有视频到 `public/prefetched/` 后再合并，输出在 `out/merged-YYYYMMDD-HHMMSS.mp4`）。
								{mergeBlobCount > 0
									? `\n注意：当前有 ${mergeBlobCount} 个视频是 blob: URL（浏览器内存地址），Node/Remotion 无法直接访问。建议让视频模型返回 video_url（可下载/可访问的 URL）。`
									: ''}
							</div>
						</div>
					</Panel>

					{error ? (
						<div
							style={{
								background: 'rgba(251,146,60,0.12)',
								border: '1px solid rgba(251,146,60,0.26)',
								borderRadius: 16,
								padding: 14,
								color: PALETTE.text,
								whiteSpace: 'pre-wrap',
								fontSize: 12,
								lineHeight: 1.5,
							}}
						>
							{error}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
};
