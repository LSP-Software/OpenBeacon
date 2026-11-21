package net.openbeacon.geoprobe;

import android.app.Activity;
import android.location.Address;
import android.location.Geocoder;
import android.os.Bundle;
import android.util.Log;
import android.widget.TextView;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;

public class Main extends Activity {
  static final double[] NONE = null;
  static final double[] NLONDON = {51.5, -0.5, 52.0, 0.0};
  static final double[] MANC = {53.25, -2.5, 53.75, -2.0};
  static final double[] CORNWALL = {50.0, -5.0, 50.5, -4.5};

  static final Object[][] CASES = {
    {"Tesco Barnet", NONE}, {"Tesco Barnet", NLONDON},
    {"Tesco", NLONDON}, {"Sainsbury's", NLONDON}, {"Tesco Extra", MANC},
    {"Underhill School", NLONDON}, {"Underhill School Barnet", NONE},
    {"St John's Church of England Primary School Whetstone", NONE},
    {"primary school", NLONDON},
    {"Barnet Hospital", NONE}, {"British Museum", NONE},
    {"EN5 3DJ", NONE}, {"SW1A 1AA", NONE}, {"M1 1AE", NONE}, {"EN5", NONE},
    {"10 Downing Street, London", NONE}, {"221B Baker Street", NONE}, {"12 Wood Street", NLONDON},
    {"High Street", NONE}, {"High Street", NLONDON}, {"High Street", MANC},
    {"Eden Project", NONE}, {"Eden Project", NLONDON}, {"Eden Project", CORNWALL},
    {"Tesco Barnet", MANC},
    {"asdkjhqwe", NONE},
  };

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    TextView t = new TextView(this);
    t.setText("GeoProbe running; see logcat GEO. isPresent=" + Geocoder.isPresent());
    setContentView(t);
    new Thread(this::run).start();
  }

  void run() {
    Geocoder g = new Geocoder(this, Locale.UK);
    Log.i("GEO", "isPresent=" + Geocoder.isPresent());
    for (Object[] c : CASES) {
      String q = (String) c[0];
      double[] box = (double[]) c[1];
      String label = q + " | box=" + (box == null ? "none" : box[0] + "," + box[1] + "," + box[2] + "," + box[3]);
      CountDownLatch latch = new CountDownLatch(1);
      AtomicReference<List<Address>> res = new AtomicReference<>();
      AtomicReference<String> err = new AtomicReference<>();
      long start = System.currentTimeMillis();
      Geocoder.GeocodeListener l = new Geocoder.GeocodeListener() {
        @Override public void onGeocode(List<Address> a) { res.set(a); latch.countDown(); }
        @Override public void onError(String m) { err.set(String.valueOf(m)); latch.countDown(); }
      };
      if (box == null) g.getFromLocationName(q, 5, l);
      else g.getFromLocationName(q, 5, box[0], box[1], box[2], box[3], l);
      try { latch.await(); } catch (InterruptedException e) { return; }
      long ms = System.currentTimeMillis() - start;
      if (err.get() != null) { Log.i("GEO", "CASE " + label + " | " + ms + "ms | ERROR " + err.get()); continue; }
      List<Address> a = res.get();
      Log.i("GEO", "CASE " + label + " | " + ms + "ms | n=" + (a == null ? 0 : a.size()));
      if (a == null) continue;
      for (Address x : a) {
        StringBuilder s = new StringBuilder("  R");
        s.append(" feature=").append(x.getFeatureName()).append(" premises=").append(x.getPremises())
         .append(" subThoroughfare=").append(x.getSubThoroughfare()).append(" thoroughfare=").append(x.getThoroughfare())
         .append(" subLocality=").append(x.getSubLocality()).append(" locality=").append(x.getLocality())
         .append(" subAdmin=").append(x.getSubAdminArea()).append(" admin=").append(x.getAdminArea())
         .append(" postal=").append(x.getPostalCode()).append(" country=").append(x.getCountryCode())
         .append(" lat=").append(x.hasLatitude() ? x.getLatitude() : null).append(" lon=").append(x.hasLongitude() ? x.getLongitude() : null)
         .append(" phone=").append(x.getPhone()).append(" url=").append(x.getUrl()).append(" extras=").append(x.getExtras());
        for (int i = 0; i <= x.getMaxAddressLineIndex(); i++) s.append(" line").append(i).append("=").append(x.getAddressLine(i));
        Log.i("GEO", s.toString());
      }
    }
    Log.i("GEO", "DONE");
  }
}
