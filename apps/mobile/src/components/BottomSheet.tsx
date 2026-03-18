import React, { useEffect } from 'react';
import { View, StyleSheet, Dimensions, TouchableWithoutFeedback, Modal } from 'react-native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  withTiming, 
  runOnJS, 
  useAnimatedGestureHandler, 
  interpolate, 
  Extrapolate 
} from 'react-native-reanimated';
import { PanGestureHandler, PanGestureHandlerGestureEvent } from 'react-native-gesture-handler';
import { theme } from '../constants/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  snapPoint?: number; // Distance from top. Default is SCREEN_HEIGHT * 0.35 (so it covers bottom 65%)
}

export const BottomSheet = ({ visible, onClose, children, snapPoint = SCREEN_HEIGHT * 0.35 }: BottomSheetProps) => {
  const translateY = useSharedValue(SCREEN_HEIGHT);
  const active = useSharedValue(false);

  const scrollTo = (destination: number) => {
    'worklet';
    active.value = destination !== SCREEN_HEIGHT;
    translateY.value = withSpring(destination, { damping: 26, stiffness: 300 });
  };

  useEffect(() => {
    if (visible) {
      scrollTo(snapPoint);
    } else {
      scrollTo(SCREEN_HEIGHT);
    }
  }, [visible, snapPoint]);

  const handleBackdropPress = () => {
    onClose();
  };

  const gestureHandler = useAnimatedGestureHandler<PanGestureHandlerGestureEvent, { startY: number }>({
    onStart: (_, ctx) => {
      ctx.startY = translateY.value;
    },
    onActive: (event, ctx) => {
      translateY.value = Math.max(snapPoint, ctx.startY + event.translationY);
    },
    onEnd: (event) => {
      if (event.translationY > 100 || event.velocityY > 500) {
        // Swipe down threshold met
        runOnJS(onClose)();
      } else {
        // Spring back to snap point
        scrollTo(snapPoint);
      }
    },
  });

  const bottomSheetStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }],
    };
  });

  const backdropStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(
        translateY.value,
        [SCREEN_HEIGHT, snapPoint],
        [0, 1],
        Extrapolate.CLAMP
      ),
    };
  });

  if (!visible && !active.value) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={handleBackdropPress}>
         <Animated.View style={[styles.backdrop, backdropStyle]} />
      </TouchableWithoutFeedback>

      <PanGestureHandler onGestureEvent={gestureHandler}>
        <Animated.View style={[styles.bottomSheetContainer, bottomSheetStyle, { top: snapPoint }]}>
          <View style={styles.dragHandleWrap}>
             <View style={styles.dragHandle} />
          </View>
          {children}
        </Animated.View>
      </PanGestureHandler>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(26,23,20,0.4)', // Strict requirements
    zIndex: 1,
  },
  bottomSheetContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -100, // overscroll prevention
    backgroundColor: theme.colors.neutral.white,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
    shadowColor: theme.colors.primary.ink,
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -5 },
    elevation: 20,
    zIndex: 2,
    paddingBottom: 100,
  },
  dragHandleWrap: {
    width: '100%',
    height: 30, // larger hit area
    alignItems: 'center',
    paddingTop: 10,
  },
  dragHandle: {
    width: 32,
    height: 4,
    backgroundColor: theme.colors.neutral.border, // #E4DFD6
    borderRadius: theme.borderRadius.full,
  },
});
