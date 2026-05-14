import React from 'react';
import { View, Text, Image, StyleSheet, SafeAreaView } from 'react-native';

// Using remote asset to ensure build passes while local assets are repaired
const LOGO_URL = 'https://raw.githubusercontent.com/DimensionsPro/Measure/main/app/assets/images/logo-pro-horizontal.png';

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Image source={{ uri: LOGO_URL }} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title}>DimensionsPro</Text>
        <Text style={styles.subtitle}>Measure • Quote • Close</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
  },
  logo: {
    width: 300,
    height: 100,
    marginBottom: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FF6B00',
  },
  subtitle: {
    fontSize: 18,
    color: '#00BFFF',
    marginTop: 10,
  }
});
