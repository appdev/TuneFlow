package cn.toside.music.mobile.utils;

import android.content.pm.PackageManager;
import android.graphics.Color;
import android.view.View;
import android.widget.Button;
import com.journeyapps.barcodescanner.CaptureActivity;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;
import com.journeyapps.barcodescanner.Size;
import cn.toside.music.mobile.R;

/** 配对专用扫码页；相机生命周期与权限处理仍由 ZXing 管理。 */
public class AccountTransferCaptureActivity extends CaptureActivity {
  private boolean torchOn;

  @Override protected DecoratedBarcodeView initializeContent() {
    setContentView(R.layout.account_transfer_capture);
    getWindow().setStatusBarColor(Color.rgb(17, 22, 27));
    getWindow().setNavigationBarColor(Color.rgb(17, 22, 27));
    getWindow().getDecorView().setSystemUiVisibility(0);
    View root = findViewById(R.id.transfer_capture_root);
    // Android 15 强制 edge-to-edge 时也避开状态栏、刘海与手势导航区。
    root.setOnApplyWindowInsetsListener((view, insets) -> {
      view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
      return insets;
    });
    root.requestApplyInsets();
    findViewById(R.id.transfer_scan_back).setOnClickListener(view -> { setResult(RESULT_CANCELED); finish(); });
    DecoratedBarcodeView scanner = findViewById(R.id.transfer_barcode_scanner);
    scanner.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
      if (right - left == oldRight - oldLeft && bottom - top == oldBottom - oldTop) return;
      int maximum = Math.round(320 * getResources().getDisplayMetrics().density);
      int side = Math.min(maximum, Math.round(Math.min(right - left, bottom - top) * 0.78f));
      if (side > 0) scanner.getBarcodeView().setFramingRectSize(new Size(side, side));
    });
    Button torch = findViewById(R.id.transfer_scan_torch);
    torch.setVisibility(getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_FLASH) ? View.VISIBLE : View.GONE);
    torch.setOnClickListener(view -> {
      torchOn = !torchOn;
      if (torchOn) scanner.setTorchOn(); else scanner.setTorchOff();
      torch.setText(torchOn ? "关闭补光" : "光线较暗？打开补光");
    });
    return scanner;
  }
}
