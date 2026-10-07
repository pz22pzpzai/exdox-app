import { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export type MileageWaypoint = { id: string; postcode: string };

function WaypointRow({ waypoint, index, count, disabled, onChange, onMove, onRemove }: {
  waypoint: MileageWaypoint;
  index: number;
  count: number;
  disabled: boolean;
  onChange: (id: string, postcode: string) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
}) {
  const position = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const indexRef = useRef(index);
  indexRef.current = index;
  const countRef = useRef(count);
  countRef.current = count;
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: () => !disabled,
    onPanResponderGrant: () => setDragging(true),
    onPanResponderMove: (_event, gesture) => position.setValue(gesture.dy),
    onPanResponderRelease: (_event, gesture) => {
      position.setValue(0);
      setDragging(false);
      const from = indexRef.current;
      const to = Math.max(0, Math.min(countRef.current - 1, from + Math.round(gesture.dy / 64)));
      if (to !== from) moveRef.current(from, to);
    },
    onPanResponderTerminate: () => { position.setValue(0); setDragging(false); },
    onPanResponderTerminationRequest: () => false,
  }), [disabled, position]);
  const label = index === 0 ? 'Start' : index === count - 1 ? 'Destination' : `Stop ${index}`;

  return (
    <Animated.View style={[styles.row, dragging && styles.dragging, { transform: [{ translateY: position }] }]}>
      <View {...responder.panHandlers} style={styles.dragHandle} accessible accessibilityRole="button" accessibilityLabel={`Drag ${label} to reorder`} accessibilityHint="Drag up or down to change the journey order">
        <Ionicons name="reorder-three" size={23} color="#53645f" />
      </View>
      <View style={styles.inputGroup}>
        <Text style={styles.label}>{label}</Text>
        <TextInput
          value={waypoint.postcode}
          onChangeText={(value) => onChange(waypoint.id, value)}
          placeholder="UK postcode"
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!disabled}
          textAlignVertical="center"
          style={styles.input}
          accessibilityLabel={`${label} postcode`}
        />
      </View>
      <View style={styles.actions}>
        <Pressable onPress={() => onMove(index, index - 1)} disabled={disabled || index === 0} accessibilityRole="button" accessibilityLabel={`Move ${label} up`} style={styles.action}>
          <Ionicons name="chevron-up" size={18} color={index === 0 ? '#adb8b5' : '#0c716a'} />
        </Pressable>
        <Pressable onPress={() => onMove(index, index + 1)} disabled={disabled || index === count - 1} accessibilityRole="button" accessibilityLabel={`Move ${label} down`} style={styles.action}>
          <Ionicons name="chevron-down" size={18} color={index === count - 1 ? '#adb8b5' : '#0c716a'} />
        </Pressable>
      </View>
      {index > 0 && index < count - 1 ? (
        <Pressable onPress={() => onRemove(waypoint.id)} disabled={disabled} accessibilityRole="button" accessibilityLabel={`Remove ${label}`} style={styles.remove}>
          <Ionicons name="close" size={18} color="#a52929" />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

export function MileageWaypointsEditor({ waypoints, disabled, onChange, onAdd, onMove, onRemove }: {
  waypoints: MileageWaypoint[];
  disabled: boolean;
  onChange: (id: string, postcode: string) => void;
  onAdd: () => void;
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.help}>Add stops in journey order. Drag the handle or use the arrows to change the order.</Text>
      {waypoints.map((waypoint, index) => (
        <WaypointRow key={waypoint.id} waypoint={waypoint} index={index} count={waypoints.length} disabled={disabled} onChange={onChange} onMove={onMove} onRemove={onRemove} />
      ))}
      <Pressable onPress={onAdd} disabled={disabled} accessibilityRole="button" accessibilityLabel="Add stop" style={styles.add}>
        <Ionicons name="add-circle-outline" size={19} color="#0c716a" />
        <Text style={styles.addText}>Add stop</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  help: { fontSize: 12, lineHeight: 17, color: '#53645f' },
  row: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 5, padding: 5, borderRadius: 10, borderWidth: 1, borderColor: '#d5e4e1', backgroundColor: '#fff' },
  dragging: { zIndex: 2, elevation: 4, borderColor: '#0c716a' },
  dragHandle: { width: 30, height: 46, alignItems: 'center', justifyContent: 'center' },
  inputGroup: { flex: 1, minWidth: 0, gap: 2 },
  label: { fontSize: 11, fontWeight: '700', color: '#53645f' },
  input: { minHeight: 40, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: '#f6fbfa', color: '#152723', fontSize: 14 },
  actions: { gap: 0 },
  action: { width: 27, height: 23, alignItems: 'center', justifyContent: 'center' },
  remove: { width: 24, height: 46, alignItems: 'center', justifyContent: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: '#e6f1ee' },
  addText: { fontSize: 13, fontWeight: '700', color: '#0c716a' },
});
