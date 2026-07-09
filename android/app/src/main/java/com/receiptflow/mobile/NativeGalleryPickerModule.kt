package com.receiptflow.mobile

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.provider.MediaStore
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import java.io.File

class NativeGalleryPickerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private var pendingPromise: Promise? = null

  private val activityEventListener: ActivityEventListener =
    object : BaseActivityEventListener() {
      override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_CODE) {
          return
        }

        val promise = pendingPromise ?: return
        pendingPromise = null

        if (resultCode != Activity.RESULT_OK) {
          promise.resolve(null)
          return
        }

        val sourceUri = data?.data
        if (sourceUri == null) {
          promise.reject("NO_IMAGE_URI", "The gallery did not return an image.")
          return
        }

        try {
          val fileName = resolveFileName(sourceUri)
          val cachedFile = copyToCache(sourceUri, fileName)
          val result = WritableNativeMap()
          result.putString("uri", Uri.fromFile(cachedFile).toString())
          result.putString("fileName", cachedFile.name)
          promise.resolve(result)
        } catch (error: Exception) {
          promise.reject("IMAGE_COPY_FAILED", "The selected image could not be imported.", error)
        }
      }
    }

  init {
    reactContext.addActivityEventListener(activityEventListener)
  }

  override fun getName(): String = "NativeGalleryPicker"

  @ReactMethod
  fun open(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "The gallery cannot open because the app activity is not ready.")
      return
    }

    if (pendingPromise != null) {
      promise.reject("PICKER_BUSY", "A gallery picker is already open.")
      return
    }

    pendingPromise = promise

    val intent = Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI).apply {
      type = "image/*"
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    try {
      activity.startActivityForResult(intent, REQUEST_CODE)
    } catch (error: Exception) {
      pendingPromise = null
      promise.reject("OPEN_GALLERY_FAILED", "The photo gallery could not be opened.", error)
    }
  }

  private fun resolveFileName(uri: Uri): String {
    var displayName: String? = null
    reactContext.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
      val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
      if (nameIndex >= 0 && cursor.moveToFirst()) {
        displayName = cursor.getString(nameIndex)
      }
    }

    val baseName = displayName
      ?.substringAfterLast('/')
      ?.replace(Regex("[^A-Za-z0-9._-]"), "-")
      ?.takeIf { it.isNotBlank() }
      ?: "gallery-${System.currentTimeMillis()}.jpg"

    return if (baseName.contains('.')) baseName else "$baseName.jpg"
  }

  private fun copyToCache(uri: Uri, fileName: String): File {
    val importsDir = File(reactContext.cacheDir, "gallery-imports")
    importsDir.mkdirs()

    val safeFile = File(importsDir, "${System.currentTimeMillis()}-$fileName")
    reactContext.contentResolver.openInputStream(uri).use { input ->
      if (input == null) {
        throw IllegalStateException("Could not read selected image.")
      }
      safeFile.outputStream().use { output ->
        input.copyTo(output)
      }
    }

    return safeFile
  }

  companion object {
    private const val REQUEST_CODE = 42017
  }
}
