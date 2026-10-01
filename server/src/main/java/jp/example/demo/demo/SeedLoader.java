package jp.example.demo.demo;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import jp.example.demo.Fhir;
import org.hl7.fhir.r4.model.Resource;

/** classpath の `seed/index.txt` に列挙された FHIR JSON（架空の初期データ）を読み込む。 */
public final class SeedLoader {
    private final String base;

    public SeedLoader() {
        this("seed");
    }

    public SeedLoader(String base) {
        this.base = base;
    }

    public List<Resource> load() {
        List<Resource> out = new ArrayList<>();
        for (String file : readLines(base + "/index.txt")) {
            try (InputStream in = open(base + "/" + file)) {
                out.add((Resource) Fhir.json().parseResource(new String(in.readAllBytes(), StandardCharsets.UTF_8)));
            } catch (IOException e) {
                throw new UncheckedIOException("初期データを読み込めません: " + file, e);
            }
        }
        return out;
    }

    private List<String> readLines(String path) {
        List<String> lines = new ArrayList<>();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(open(path), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (!line.isBlank() && !line.startsWith("#")) {
                    lines.add(line.trim());
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException("初期データの一覧を読み込めません: " + path, e);
        }
        return lines;
    }

    private static InputStream open(String path) throws IOException {
        InputStream in = SeedLoader.class.getClassLoader().getResourceAsStream(path);
        if (in == null) {
            throw new IOException("リソースが見つかりません: " + path);
        }
        return in;
    }
}
