import {
	AbsoluteFill,
	Easing,
	useCurrentFrame,
	useVideoConfig,
	interpolate,
	spring,
	Sequence,
} from 'remotion';

const PALETTE = {
	bg0: '#07090D',
	bg1: '#0B1118',
	text: 'rgba(255,255,255,0.92)',
	textMuted: 'rgba(255,255,255,0.62)',
	glass: 'rgba(255,255,255,0.08)',
	glassStrong: 'rgba(255,255,255,0.14)',
	accentA: '#19D3AE',
	accentB: '#A3FF6F',
};

const BootBackground = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const power = interpolate(frame, [0, 2 * fps], [0, 1], {
		easing: Easing.out(Easing.cubic),
		extrapolateRight: 'clamp',
	});

	const drift = Math.sin((frame / fps) * 0.6) * 14;
	const glowA = 0.55 * power;
	const glowB = 0.28 * power;

	return (
		<AbsoluteFill style={{ backgroundColor: PALETTE.bg0 }}>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					background: `linear-gradient(180deg, ${PALETTE.bg1} 0%, ${PALETTE.bg0} 75%)`,
				}}
			/>
			<div
				style={{
					position: 'absolute',
					inset: -220,
					background: `radial-gradient(circle at 50% 45%, rgba(25,211,174,${glowA}) 0%, rgba(25,211,174,0) 62%)`,
					transform: `translate3d(0, ${drift}px, 0)`,
					filter: 'blur(70px)',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					inset: -260,
					background: `radial-gradient(circle at 20% 85%, rgba(163,255,111,${glowB}) 0%, rgba(163,255,111,0) 68%)`,
					transform: `translate3d(0, ${-drift * 0.6}px, 0)`,
					filter: 'blur(80px)',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					inset: 0,
					background:
						'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.68) 66%, rgba(0,0,0,0.92) 100%)',
				}}
			/>
		</AbsoluteFill>
	);
};

const Logo = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const inProgress = spring({
		frame,
		fps,
		durationInFrames: 28,
		config: { damping: 14, stiffness: 240, mass: 0.9 },
	});

	const opacity = interpolate(frame, [0, 10], [0, 1], {
		easing: Easing.out(Easing.quad),
		extrapolateRight: 'clamp',
	});
	const scale = interpolate(inProgress, [0, 1], [0.55, 1]);
	const y = interpolate(inProgress, [0, 1], [24, 0]);
	const rotate = interpolate(inProgress, [0, 1], [-8, 0]);

	const shineX = interpolate(frame, [10, 42], [-120, 120], {
		easing: Easing.inOut(Easing.cubic),
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const shineOpacity = interpolate(frame, [0, 10, 18, 42], [0, 0, 0.32, 0], {
		extrapolateRight: 'clamp',
	});

	return (
		<div
			style={{
				width: 152,
				height: 152,
				opacity,
				transform: `translate3d(0, ${y}px, 0) rotate(${rotate}deg) scale(${scale})`,
				willChange: 'transform, opacity',
			}}
		>
			<div
				style={{
					position: 'relative',
					width: '100%',
					height: '100%',
					borderRadius: 34,
					background: `linear-gradient(135deg, ${PALETTE.accentA} 0%, ${PALETTE.accentB} 100%)`,
					padding: 2,
					boxShadow:
						'0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08) inset',
				}}
			>
				<div
					style={{
						position: 'absolute',
						inset: 2,
						borderRadius: 32,
						background: 'rgba(6,10,14,0.82)',
						border: '1px solid rgba(255,255,255,0.08)',
						overflow: 'hidden',
					}}
				>
					<div
						style={{
							position: 'absolute',
							inset: 26,
							borderRadius: '50%',
							background:
								'radial-gradient(circle at 35% 30%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 48%), radial-gradient(circle at 65% 70%, rgba(25,211,174,0.65) 0%, rgba(25,211,174,0) 62%), radial-gradient(circle at 40% 70%, rgba(163,255,111,0.45) 0%, rgba(163,255,111,0) 68%)',
							opacity: 0.95,
							filter: 'blur(0.2px)',
						}}
					/>
					<div
						style={{
							position: 'absolute',
							top: -60,
							bottom: -60,
							width: 90,
							left: 0,
							background:
								'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0) 100%)',
							transform: `translate3d(${shineX}px, 0, 0) rotate(20deg)`,
							opacity: shineOpacity,
							filter: 'blur(1px)',
						}}
					/>
					<div
						style={{
							position: 'absolute',
							inset: 0,
							borderRadius: 32,
							boxShadow: '0 0 0 1px rgba(255,255,255,0.06) inset',
						}}
					/>
				</div>
			</div>
		</div>
	);
};

const LoadingSpinner = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const rotation = frame * 12;
	const opacity = interpolate(frame, [8, 18], [0, 1], {
		easing: Easing.out(Easing.quad),
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const pulse = 1 + Math.sin((frame / fps) * 6) * 0.045;

	return (
		<div
			style={{
				width: 46,
				height: 46,
				opacity,
				transform: `rotate(${rotation}deg) scale(${pulse})`,
				background:
					'conic-gradient(from 20deg, rgba(255,255,255,0) 0deg, rgba(25,211,174,0.95) 85deg, rgba(163,255,111,0.9) 140deg, rgba(255,255,255,0) 220deg, rgba(255,255,255,0) 360deg)',
				borderRadius: '50%',
				WebkitMaskImage:
					'radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px))',
				maskImage:
					'radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px))',
				boxShadow: '0 0 0 1px rgba(255,255,255,0.10) inset',
			}}
		/>
	);
};

const WelcomeText = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const titleIn = spring({
		frame,
		fps,
		durationInFrames: 30,
		config: { damping: 18, stiffness: 160 },
	});
	const subIn = spring({
		frame: frame - 10,
		fps,
		durationInFrames: 28,
		config: { damping: 22, stiffness: 160 },
	});

	const titleOpacity = interpolate(frame, [0, 12], [0, 1], {
		easing: Easing.out(Easing.quad),
		extrapolateRight: 'clamp',
	});
	const titleY = interpolate(titleIn, [0, 1], [26, 0]);
	const titleBlur = interpolate(titleIn, [0, 1], [10, 0]);
	const tracking = interpolate(titleIn, [0, 1], [3, -0.5]);

	const subOpacity = interpolate(subIn, [0, 1], [0, 1], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const subY = interpolate(subIn, [0, 1], [14, 0]);

	return (
		<AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					gap: 14,
				}}
			>
				<span
					style={{
						fontSize: 54,
						fontWeight: 620,
						color: PALETTE.text,
						letterSpacing: tracking,
						opacity: titleOpacity,
						transform: `translate3d(0, ${titleY}px, 0)`,
						filter: `blur(${titleBlur}px)`,
						textShadow: '0 10px 30px rgba(0,0,0,0.45)',
					}}
				>
					Welcome
				</span>
				<span
					style={{
						fontSize: 18,
						color: PALETTE.textMuted,
						fontWeight: 420,
						opacity: subOpacity,
						transform: `translate3d(0, ${subY}px, 0)`,
						letterSpacing: 0.2,
					}}
				>
					Getting things ready for you...
				</span>
			</div>
		</AbsoluteFill>
	);
};

const Desktop = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const sceneIn = spring({
		frame,
		fps,
		durationInFrames: 26,
		config: { damping: 22, stiffness: 160 },
	});

	const opacity = interpolate(sceneIn, [0, 1], [0, 1]);
	const scale = interpolate(sceneIn, [0, 1], [1.02, 1]);

	const icons = [
		{ label: 'Files', a: '#19D3AE', b: '#A3FF6F', glyph: 'F' },
		{ label: 'Docs', a: '#A3FF6F', b: '#FDE68A', glyph: 'D' },
		{ label: 'Browser', a: '#19D3AE', b: '#38BDF8', glyph: 'B' },
		{ label: 'Chat', a: '#38BDF8', b: '#19D3AE', glyph: 'C' },
		{ label: 'Music', a: '#FDE68A', b: '#A3FF6F', glyph: 'M' },
	];

	return (
		<AbsoluteFill
			style={{
				opacity,
				transform: `scale(${scale})`,
			}}
		>
			<div
				style={{
					width: '100%',
					height: '100%',
					background:
						'linear-gradient(135deg, #07121D 0%, #0B1118 55%, #07090D 100%)',
				}}
			>
				<div
					style={{
						position: 'absolute',
						top: 40,
						left: 40,
						display: 'flex',
						flexDirection: 'column',
						gap: 20,
					}}
				>
					{icons.map((icon, i) => {
						const iconProgress = spring({
							frame: frame - 6 - i * 6,
							fps,
							durationInFrames: 22,
							config: { damping: 14, stiffness: 220 },
						});
						const iconScale = interpolate(iconProgress, [0, 1], [0.62, 1]);
						const iconOpacity = interpolate(iconProgress, [0, 1], [0, 1]);
						const iconY = interpolate(iconProgress, [0, 1], [16, 0]);
						const iconRot = interpolate(iconProgress, [0, 1], [-4, 0]);
						const iconBlur = interpolate(iconProgress, [0, 1], [8, 0]);

						return (
							<div
								key={i}
								style={{
									display: 'flex',
									flexDirection: 'column',
									alignItems: 'center',
									gap: 6,
									opacity: iconOpacity,
									transform: `translate3d(0, ${iconY}px, 0) rotate(${iconRot}deg) scale(${iconScale})`,
									filter: `blur(${iconBlur}px)`,
								}}
							>
								<div
									style={{
										width: 64,
										height: 64,
										background: `linear-gradient(135deg, ${icon.a} 0%, ${icon.b} 100%)`,
										borderRadius: 12,
										display: 'flex',
										justifyContent: 'center',
										alignItems: 'center',
										color: 'rgba(8,10,12,0.86)',
										fontSize: 22,
										fontWeight: 720,
										letterSpacing: -0.5,
										boxShadow:
											'0 14px 28px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.10) inset',
									}}
								>
									{icon.glyph}
								</div>
								<span style={{ color: 'rgba(255,255,255,0.78)', fontSize: 12 }}>
									{icon.label}
								</span>
							</div>
						);
					})}
				</div>

				<div
					style={{
						position: 'absolute',
						bottom: 40,
						left: 0,
						right: 0,
						height: 60,
						background: 'rgba(255,255,255,0.10)',
						backdropFilter: 'blur(10px)',
						borderTop: '1px solid rgba(255,255,255,0.12)',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						gap: 16,
					}}
				>
					{[...Array(7)].map((_, i) => {
						const dockProgress = spring({
							frame: frame - 16 - i * 4,
							fps,
							durationInFrames: 18,
							config: { damping: 14, stiffness: 240 },
						});
						const dockScale = interpolate(dockProgress, [0, 1], [0.3, 1]);
						const dockY = interpolate(dockProgress, [0, 1], [10, 0]);

						return (
							<div
								key={i}
								style={{
									width: 40,
									height: 40,
									background: 'rgba(255,255,255,0.14)',
									borderRadius: 8,
									transform: `translate3d(0, ${dockY}px, 0) scale(${dockScale})`,
									boxShadow: '0 10px 20px rgba(0,0,0,0.25)',
								}}
							/>
						);
					})}
				</div>
			</div>
		</AbsoluteFill>
	);
};

const SceneBlackScreen = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const opacity = interpolate(frame, [0, 2 * fps], [1, 0], {
		easing: Easing.out(Easing.quad),
		extrapolateRight: 'clamp',
	});

	return <AbsoluteFill style={{ background: 'black', opacity }} />;
};

const SceneLogo = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const durationInFrames = 3 * fps;

	const out = interpolate(frame, [durationInFrames - 14, durationInFrames], [0, 1], {
		easing: Easing.in(Easing.quad),
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const opacity = interpolate(out, [0, 1], [1, 0]);
	const y = interpolate(out, [0, 1], [0, -10]);

	return (
		<AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					gap: 26,
					opacity,
					transform: `translate3d(0, ${y}px, 0)`,
				}}
			>
				<Logo />
				<LoadingSpinner />
			</div>
		</AbsoluteFill>
	);
};

const SceneWelcome = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const durationInFrames = 2 * fps;

	const out = interpolate(frame, [durationInFrames - 14, durationInFrames], [0, 1], {
		easing: Easing.in(Easing.quad),
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
	});
	const opacity = interpolate(out, [0, 1], [1, 0]);
	const y = interpolate(out, [0, 1], [0, -8]);

	return (
		<AbsoluteFill style={{ opacity, transform: `translate3d(0, ${y}px, 0)` }}>
			<WelcomeText />
		</AbsoluteFill>
	);
};

const SceneDesktop = () => {
	return <Desktop />;
};

export const BootAnimation = () => {
	const { fps } = useVideoConfig();

	return (
		<AbsoluteFill style={{ background: PALETTE.bg0 }}>
			<BootBackground />
			<Sequence from={0} durationInFrames={2 * fps} premountFor={fps}>
				<SceneBlackScreen />
			</Sequence>
			<Sequence from={2 * fps} durationInFrames={3 * fps} premountFor={fps}>
				<SceneLogo />
			</Sequence>
			<Sequence from={5 * fps} durationInFrames={2 * fps} premountFor={fps}>
				<SceneWelcome />
			</Sequence>
			<Sequence from={7 * fps} durationInFrames={2 * fps} premountFor={fps}>
				<SceneDesktop />
			</Sequence>
		</AbsoluteFill>
	);
};
