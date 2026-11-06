// Dump FASTag's rank-sum null tables (include/FASTag/ranksum.h) for Note S1.
//
//   c++ -std=c++20 -O2 -I <FASTag>/include scripts/ranksum_dump.cpp -o ranksum_dump
//   ./ranksum_dump <k_min> <k_max> <n_max> <out.bin> > build_times.tsv
//
// For each k in [k_min, k_max] it calls FASTag::ranksumCdfs(k, n_max), the function the
// tagger uses (Tables::Tables), times it (best of 5 builds) and appends the float CDFs of
// every n in [k, n_max] to out.bin in (k, n, s) order, little-endian float32.
// scripts/ranksum_range.py reads the dump and checks its own replica against it bit for bit.
#include <FASTag/ranksum.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>

int main(int argc, char** argv)
{
  if (argc != 5) { std::fprintf(stderr, "usage: %s k_min k_max n_max out.bin\n", argv[0]); return 2; }
  const int k_min = std::atoi(argv[1]), k_max = std::atoi(argv[2]), n_max = std::atoi(argv[3]);
  std::FILE* out = std::fopen(argv[4], "wb");
  if (!out) { std::perror(argv[4]); return 1; }
  std::printf("k\tn_max\tbuild_seconds_best_of_5\n");
  for (int k = k_min; k <= k_max; ++k)
  {
    double best = 1e300;
    std::vector<std::vector<float>> t;
    for (int rep = 0; rep < 5; ++rep)
    {
      const auto t0 = std::chrono::steady_clock::now();
      t = FASTag::ranksumCdfs(k, n_max);
      const double s = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
      if (s < best) best = s;
    }
    std::printf("%d\t%d\t%.6f\n", k, n_max, best);
    for (int n = k; n <= n_max; ++n)
      std::fwrite(t[static_cast<size_t>(n)].data(), sizeof(float), t[static_cast<size_t>(n)].size(), out);
  }
  std::fclose(out);
  return 0;
}
