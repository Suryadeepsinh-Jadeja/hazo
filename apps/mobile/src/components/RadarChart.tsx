import React, { useEffect } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import Svg, { Polygon, Line, Circle, Text as SvgText } from 'react-native-svg';
import Animated, { useSharedValue, useAnimatedProps, withTiming, Easing } from 'react-native-reanimated';
import { theme } from '../constants/theme';

const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface RadarChartProps {
  skills: { name: string; masteryLevel: number }[];
  size: number;
}

export const RadarChart = ({ skills, size }: RadarChartProps) => {
  const center = size / 2;
  const radius = center * 0.65; // Leave enough padding for labels
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, { duration: 1200, easing: Easing.out(Easing.cubic) });
  }, [skills]);

  // Handle empty or insufficient skills to form a polygon
  if (!skills || skills.length < 3) {
    return (
      <View style={[styles.emptyContainer, { width: size, height: size }]}>
        <View style={[styles.placeholderCircle, { width: radius * 2, height: radius * 2, borderRadius: radius }]} />
        <Text style={styles.emptyText}>Complete topics to build your Skills Graph</Text>
      </View>
    );
  }

  const angleStep = (Math.PI * 2) / skills.length;

  // Regular JS helper – used ONLY outside of worklets (grid lines, axes, labels)
  const getPoint = (level: number, i: number, prg: number = 1) => {
    const angle = i * angleStep - Math.PI / 2;
    const currentLevel = level * prg;
    const r = (currentLevel / 100) * radius;
    return {
       x: center + r * Math.cos(angle),
       y: center + r * Math.sin(angle)
    };
  };

  // ── Animated polygon (worklet-safe) ──────────────────────────────────
  const skillLevels = skills.map(s => s.masteryLevel);
  const numSkills = skills.length;

  const animatedPolygonProps = useAnimatedProps(() => {
    'worklet';
    const parts: string[] = [];
    for (let i = 0; i < numSkills; i++) {
      const angle = i * angleStep - Math.PI / 2;
      const r = ((skillLevels[i] * progress.value) / 100) * radius;
      parts.push(`${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`);
    }
    return { points: parts.join(' ') };
  });

  // Calculate grid points generically (runs on JS thread — no problem)
  const getGridPolygon = (percent: number) => {
     return skills.map((_, i) => {
        const p = getPoint(percent, i, 1);
        return `${p.x},${p.y}`;
     }).join(' ');
  };

  // Pre-build animated props for each dot (worklet-safe)
  const dotAnimProps = skills.map((s, i) => {
    return useAnimatedProps(() => {
      'worklet';
      const angle = i * angleStep - Math.PI / 2;
      const r = ((s.masteryLevel * progress.value) / 100) * radius;
      return { cx: center + r * Math.cos(angle), cy: center + r * Math.sin(angle) };
    });
  });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
       <Svg width={size} height={size}>
         {/* Concentric Grids at 33%, 66%, 100% */}
         {[33.33, 66.66, 100].map(pct => (
            <Polygon 
              key={pct} 
              points={getGridPolygon(pct)} 
              fill="none" 
              stroke={theme.colors.neutral.border}
              strokeWidth={1} 
            />
         ))}

         {/* Axes and Labels */}
         {skills.map((s, i) => {
            const endP = getPoint(100, i, 1);
            const labelP = getPoint(135, i, 1);
            return (
              <React.Fragment key={i}>
                 <Line x1={center} y1={center} x2={endP.x} y2={endP.y} stroke={theme.colors.neutral.border} strokeWidth={1} />
                 <SvgText 
                   x={labelP.x} 
                   y={labelP.y} 
                   fill={theme.colors.primary.inkMuted} 
                   fontSize={11} 
                   fontFamily={theme.typography.fontMono}
                   textAnchor="middle"
                   alignmentBaseline="middle"
                 >
                   {s.name.length > 12 ? `${s.name.substring(0, 10)}...` : s.name}
                 </SvgText>
              </React.Fragment>
            );
         })}

         {/* Animated Data Overlay */}
         <AnimatedPolygon 
            animatedProps={animatedPolygonProps}
            fill={theme.colors.accent.coral} 
            fillOpacity={0.15}
            stroke={theme.colors.accent.coral}
            strokeWidth={1.5}
         />

         {/* Animated Data Dots */}
         {skills.map((_, i) => (
           <AnimatedCircle
             key={`dot-${i}`}
             animatedProps={dotAnimProps[i]}
             r={5}
             fill={theme.colors.accent.coral}
             stroke={theme.colors.neutral.white}
             strokeWidth={1.5}
           />
         ))}
       </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderCircle: {
    borderWidth: 1,
    borderColor: theme.colors.neutral.borderMid,
    borderStyle: 'dashed',
    position: 'absolute',
  },
  emptyText: {
    fontFamily: theme.typography.fontBody,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.inkMuted,
    textAlign: 'center',
    maxWidth: '60%',
    lineHeight: 20,
  },
});
