import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;

class ApiService {
  static String baseUrl = const String.fromEnvironment('API_URL', defaultValue: 'http://localhost:3000');

  static Future<Map<String, dynamic>> uploadImageBytes(Uint8List bytes, {String filename = 'image.jpg'}) async {
    final uri = Uri.parse('$baseUrl/upload');
    final req = http.MultipartRequest('POST', uri)
      ..files.add(http.MultipartFile.fromBytes('image', bytes, filename: filename));
    final resp = await http.Response.fromStream(await req.send());
    if (resp.statusCode >= 200 && resp.statusCode < 300) {
      return jsonDecode(resp.body) as Map<String, dynamic>;
    }
    throw Exception('Upload failed: ${resp.statusCode} ${resp.body}');
  }

  static Future<void> uploadTask({required String id, required String title, String? note, String? imageKey}) async {
    final uri = Uri.parse('$baseUrl/tasks');
    final resp = await http.post(uri, headers: {'Content-Type': 'application/json'}, body: jsonEncode({
      'id': id,
      'title': title,
      'note': note,
      'imageKey': imageKey,
    }));
    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      throw Exception('Task save failed: ${resp.statusCode} ${resp.body}');
    }
  }
}
