import { forwardRef } from 'react';
import type { ScrollViewProps } from 'react-native';
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';

export type FormScrollHandle = KeyboardAwareScrollViewRef;

/** Keeps the focused field and its caret above the keyboard, including when
 * focus moves or a multiline editor grows while the keyboard stays open. */
export const FormScrollView = forwardRef<FormScrollHandle, ScrollViewProps>(function FormScrollView(props, ref) {
  return (
    <KeyboardAwareScrollView
      bottomOffset={24}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      {...props}
      ref={ref}
    />
  );
});
