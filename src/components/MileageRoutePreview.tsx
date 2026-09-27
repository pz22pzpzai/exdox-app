import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { calculateMileageRoute, type MileageRouteResult } from '../services/mileageRouting';

function postcodeKey(value: string): string {
  return value.toUpperCase().replace(/\s/g, '');
}

function validPostcode(value: string): boolean {
  return /^(GIR\s?0AA|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i.test(value.trim());
}

export function MileageRoutePreview({
  startPostcode,
  endPostcode,
  disabled,
  onUseRoute,
}: {
  startPostcode: string;
  endPostcode: string;
  disabled: boolean;
  onUseRoute: (miles: number, startPostcode: string, endPostcode: string) => void;
}) {
  const [result, setResult] = useState<MileageRouteResult | null>(null);
  const [calculatedKey, setCalculatedKey] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const key = `${postcodeKey(startPostcode)}>${postcodeKey(endPostcode)}`;
  const valid = validPostcode(startPostcode) && validPostcode(endPostcode) && postcodeKey(startPostcode) !== postcodeKey(endPostcode);
  const currentResult = calculatedKey === key ? result : null;
  const selectedRoute = currentResult?.routes[selectedIndex] ?? currentResult?.routes[0];

  const calculate = async () => {
    const id = ++requestId.current;
    setBusy(true);
    setError(null);
    try {
      const next = await calculateMileageRoute(startPostcode, endPostcode);
      if (id !== requestId.current) return;
      setResult(next);
      setCalculatedKey(`${postcodeKey(next.startPostcode)}>${postcodeKey(next.endPostcode)}`);
      setSelectedIndex(0);
      onUseRoute(next.routes[0].miles, next.startPostcode, next.endPostcode);
    } catch (routeError) {
      if (id !== requestId.current) return;
      setError(routeError instanceof Error ? routeError.message : 'Could not calculate the road distance. Enter miles manually or try again.');
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  };

  useEffect(() => {
    requestId.current += 1;
    setBusy(false);
    setError(null);
    setSelectedIndex(0);
  }, [key]);

  useEffect(() => {
    if (!valid || disabled || currentResult || busy || error) return;
    const timer = setTimeout(() => void calculate(), 900);
    return () => clearTimeout(timer);
  }, [key, valid, disabled, currentResult, busy, error]);

  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <View style={styles.headingText}>
          <Text style={styles.title}>Road-route mileage</Text>
          <Text style={styles.copy}>Driving distance between your postcodes. Choose the route that matches your journey.</Text>
        </View>
        <Pressable style={[styles.recalculate, (!valid || disabled || busy) && styles.disabled]} disabled={!valid || disabled || busy} onPress={() => void calculate()}>
          <Text style={styles.recalculateText}>{busy ? 'Calculating…' : 'Recalculate'}</Text>
        </Pressable>
      </View>
      {busy ? <ActivityIndicator color="#2563eb" accessibilityLabel="Calculating route" /> : null}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      {currentResult ? (
        <>
          {selectedRoute?.mapImage ? (
            <Image source={{ uri: selectedRoute.mapImage }} style={styles.map} resizeMode="cover" accessibilityLabel={`Driving route from ${currentResult.startPostcode} to ${currentResult.endPostcode}`} />
          ) : (
            <Text style={styles.copy}>Map preview is unavailable. You can still use the calculated miles.</Text>
          )}
          <Pressable onPress={() => void Linking.openURL('https://www.mapbox.com/about/maps/')} accessibilityRole="link">
            <Text style={styles.attribution}>Map data © Mapbox © OpenStreetMap</Text>
          </Pressable>
          {currentResult.routes.map((route, index) => (
            <Pressable
              key={`${index}-${route.miles}`}
              style={[styles.routeOption, index === selectedIndex && styles.routeSelected]}
              onPress={() => {
                setSelectedIndex(index);
                onUseRoute(route.miles, currentResult.startPostcode, currentResult.endPostcode);
              }}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: index === selectedIndex }}
            >
              <Text style={styles.routeTitle}>{index === 0 ? 'Suggested route' : `Alternative ${index}`} · {route.miles.toFixed(1)} miles</Text>
              <Text style={styles.routeDetails}>About {route.durationMinutes} min{route.via.length ? ` · Via ${route.via.join(', ')}` : ''}</Text>
            </Pressable>
          ))}
          <Pressable
            style={[styles.useRoute, disabled && styles.disabled]}
            disabled={disabled || !selectedRoute}
            onPress={() => selectedRoute && onUseRoute(selectedRoute.miles, currentResult.startPostcode, currentResult.endPostcode)}
          >
            <Text style={styles.useRouteText}>Use route · {selectedRoute?.miles.toFixed(1)} miles</Text>
          </Pressable>
          <Text style={styles.copy}>From postcode centres. You can adjust Total miles if your actual journey differed.</Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10, borderWidth: 1, borderColor: '#d5e4e1', borderRadius: 14, backgroundColor: '#f6fbfa', padding: 12 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  headingText: { flex: 1, gap: 4 },
  title: { fontSize: 16, fontWeight: '700', color: '#152723' },
  copy: { fontSize: 12, lineHeight: 17, color: '#53645f' },
  recalculate: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: '#e6f1ee' },
  recalculateText: { fontSize: 12, fontWeight: '700', color: '#0c716a' },
  disabled: { opacity: 0.45 },
  error: { color: '#a52929', fontSize: 12 },
  map: { width: '100%', height: 205, borderRadius: 10, backgroundColor: '#e8efed' },
  attribution: { color: '#53645f', fontSize: 10, textDecorationLine: 'underline' },
  routeOption: { gap: 3, padding: 11, borderRadius: 9, borderWidth: 1, borderColor: '#d5e4e1', backgroundColor: '#fff' },
  routeSelected: { borderColor: '#2563eb', backgroundColor: '#edf4ff' },
  routeTitle: { fontSize: 13, fontWeight: '700', color: '#152723' },
  routeDetails: { fontSize: 12, color: '#53645f' },
  useRoute: { padding: 12, borderRadius: 9, backgroundColor: '#2563eb', alignItems: 'center' },
  useRouteText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
