import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart' show defaultTargetPlatform, TargetPlatform;
import 'package:http/http.dart' as http;

class BackendService {
  BackendService({String? baseUrl})
      : baseUrl = baseUrl ?? _defaultBaseUrl();
  final String baseUrl;

  static String _defaultBaseUrl() {
    // Android emulator does not map localhost to host; use 10.0.2.2
    if (defaultTargetPlatform == TargetPlatform.android) {
      return const String.fromEnvironment('BACKEND_URL', defaultValue: 'http://10.0.2.2:3000');
    }
    return const String.fromEnvironment('BACKEND_URL', defaultValue: 'http://localhost:3000');
  }

  Future<Map<String, dynamic>> uploadImageFile(File file) async {
    final uri = Uri.parse('$baseUrl/upload');
    final request = http.MultipartRequest('POST', uri);
    request.files.add(await http.MultipartFile.fromPath('image', file.path));
    final streamed = await request.send();
    final resp = await http.Response.fromStream(streamed);
    if (resp.statusCode >= 200 && resp.statusCode < 300) {
      return jsonDecode(resp.body) as Map<String, dynamic>;
    }
    throw Exception('Upload failed: ${resp.statusCode} ${resp.body}');
  }

  Future<Map<String, dynamic>> createTask({required String title, String? description, String? imageKey}) async {
    final uri = Uri.parse('$baseUrl/tasks');
    final resp = await http.post(uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'title': title,
          'description': description,
          'imageKey': imageKey,
        }));
    if (resp.statusCode >= 200 && resp.statusCode < 300) {
      return jsonDecode(resp.body) as Map<String, dynamic>;
    }
    throw Exception('Task create failed: ${resp.statusCode} ${resp.body}');
  }
}
