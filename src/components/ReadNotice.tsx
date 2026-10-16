import { StyleSheet, View } from 'react-native';

import { explainReadFailure, type ReadFailure } from '../lib/optionalRead';
import { colors, themed } from '../theme';
import { IconPill } from './Icon';
import { Body } from './Type';

/** A failed optional read is not an empty list. Keep its cause and retry together. */
export function ReadNotice({ failure, subject, onRetry }: {
  failure: ReadFailure;
  subject: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.notice}>
      <Body style={styles.error}>{explainReadFailure(failure, subject)}</Body>
      <IconPill icon="refresh" label={`retry ${subject}`} onPress={onRetry} />
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  notice: { alignItems: 'flex-start', gap: 10, paddingVertical: 14 },
  error: { color: colors.no },
}));
