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

  const getPoint = (level: number, i: number, prg: number = 1) => {
    // Start from top (-Math.PI/2)
    const angle = i * angleStep - Math.PI / 2;
    const currentLevel = level * prg;
    const r = (currentLevel / 100) * radius;
    return {
       x: center + r * Math.cos(angle),
       y: center + r * Math.sin(angle)
    };
  };

  const animatedPolygonProps = useAnimatedProps(() => {
    const pointsString = skills.map((s, i) => {
       const p = getPoint(s.masteryLevel, i, progress.value);
       return `${p.x},${p.y}`;
    }).join(' ');
    return { points: pointsString };
  });

  // Calculate grid points generically
  const getGridPolygon = (percent: number) => {
     return skills.map((_, i) => {
        const p = getPoint(percent, i, 1);
        return `${p.x},${p.y}`;
     }).join(' ');
  };

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
       <Svg width={size} height={size}>
         {/* Concentric Grids at 33%, 66%, 100% */}
         {[33.33, 66.66, 100].map(pct => (
            <Polygon 
              key={pct} 
              points={getGridPolygon(pct)} 
              fill="none" 
              stroke={theme.colors.neutral.border} // creampaper #E4DFD6 equivalent
              strokeWidth={1} 
            />
         ))}

         {/* Axes and Lables */}
         {skills.map((s, i) => {
            const endP = getPoint(100, i, 1);
            const labelP = getPoint(135, i, 1); // pushing label out further
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
         {skills.map((s, i) => {
            const AnimatedPoint = () => {
              const animProps = useAnimatedProps(() => {
                 const p = getPoint(s.masteryLevel, i, progress.value);
                 return { cx: p.x, cy: p.y };
              });
              return (
                <AnimatedCircle 
                  animatedProps={animProps} 
                  r={5} 
                  fill={theme.colors.accent.coral} 
                  stroke={theme.colors.neutral.white} 
                  strokeWidth={1.5} 
                />
              );
            };
            return <AnimatedPoint key={`dot-${i}`} />;
         })}
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
