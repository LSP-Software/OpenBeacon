import { type ReactNode, type RefObject, useRef } from "react";
import {
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  ScrollView,
  TextInput,
  type View,
} from "react-native";
import { keyboardRevealOffset } from "../lib/keyboardRevealOffset.ts";

export const KeyboardFormScrollView = ({
  children,
  contentContainerClassName,
}: {
  children: (formProps: {
    onLayout: (event: LayoutChangeEvent) => void;
    ref: RefObject<View | null>;
  }) => ReactNode;
  contentContainerClassName: string;
}) => {
  const scrollRef = useRef<ScrollView>(null);
  const formRef = useRef<View>(null);
  const formFrameRef = useRef({ top: 0, bottom: 0 });
  const viewportHeightRef = useRef(0);
  const fullViewportHeightRef = useRef(0);

  const onViewportLayout = (event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    const previousHeight = viewportHeightRef.current;
    viewportHeightRef.current = height;
    fullViewportHeightRef.current = Math.max(fullViewportHeightRef.current, height);
    if (height >= fullViewportHeightRef.current) {
      if (previousHeight !== 0) scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    if (height >= previousHeight) return;

    const focusedInput = TextInput.State.currentlyFocusedInput();
    if (!focusedInput || !formRef.current) return;
    focusedInput.measureLayout(formRef.current, (_left, focusedTopInForm) => {
      // Fabric can report onLayout before Android applies the new viewport, which clamps scrollTo to the old range
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          y: keyboardRevealOffset({
            focusedTop: formFrameRef.current.top + focusedTopInForm,
            formBottom: formFrameRef.current.bottom,
            viewportHeight: height,
          }),
          animated: true,
        });
      });
    });
  };

  return (
    <KeyboardAvoidingView className="flex-1" behavior="padding">
      <ScrollView
        ref={scrollRef}
        contentContainerClassName={contentContainerClassName}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical={false}
        overScrollMode="never"
        onLayout={onViewportLayout}
      >
        {children({
          ref: formRef,
          onLayout: (event) => {
            const { y, height } = event.nativeEvent.layout;
            formFrameRef.current = { top: y, bottom: y + height };
          },
        })}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
