// The one proof worth running in isolation: the DP equals exhaustive enumeration.
//   The DP is what replaces DirecTag's C(n,k) subset walk, so if it is wrong,
//   every intensity p-value is wrong and nothing downstream would notice.
//   A one-n reference DP is proven against enumeration (1-5), and the
//   all-n DP the tagger uses against the reference, bit for bit (6).
#include <FASTag/ranksum.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <map>
#include <vector>

static int failures = 0;
#define CHECK(c, ...) do { if (!(c)) { ++failures; std::printf("FAIL %d: ", __LINE__); \
  std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

/// Exhaustive ground truth -- exactly what DirecTag's CalculateIRBins_R does.
/// Tractable only for tiny inputs, which is the whole point.
static std::map<int, double> brute(int k, int n)
{
  std::map<int, double> h;
  std::vector<int> idx(k);
  for (int i = 0; i < k; ++i) idx[i] = i + 1;
  for (;;)
  {
    int s = 0;
    for (int i = 0; i < k; ++i) s += idx[i];
    h[s] += 1.0;
    int i = k - 1;
    while (i >= 0 && idx[i] == n - (k - 1 - i)) --i;
    if (i < 0) break;
    ++idx[i];
    for (int j = i + 1; j < k; ++j) idx[j] = idx[j - 1] + 1;
  }
  return h;
}

/// Reference for one n: counts[s] = #{ S subset of {1..n} : |S| = k,
/// sum(S) = s }, by the same DP ranksumCdfs() runs over every n at once.
static std::vector<double> ranksumCounts(int k, int n)
{
  if (k <= 0 || n <= 0 || k > n) return {};
  const int smax = k * n - k * (k - 1) / 2;
  std::vector<std::vector<double>> dp(static_cast<size_t>(k) + 1,
                                      std::vector<double>(static_cast<size_t>(smax) + 1, 0.0));
  dp[0][0] = 1.0;
  for (int v = 1; v <= n; ++v)
    for (int j = (k < v ? k : v); j >= 1; --j)
      for (int s = smax; s >= v; --s)
        if (dp[j - 1][s - v] != 0.0) dp[j][s] += dp[j - 1][s - v];
  return dp[static_cast<size_t>(k)];
}

/// Reference CDF for one n, from ranksumCounts().
static std::vector<float> ranksumCdf(int k, int n)
{
  const std::vector<double> counts = ranksumCounts(k, n);
  double total = 0.0;
  for (double c : counts) total += c;
  std::vector<float> cdf(counts.size());
  double running = 0.0;
  for (size_t s = 0; s < counts.size(); ++s)
  {
    running += counts[s];
    cdf[s] = static_cast<float>(running / total);
  }
  return cdf;
}

static double binom(int n, int k)
{
  double r = 1.0;
  for (int i = 0; i < k; ++i) r = r * (n - i) / (i + 1);
  return r;
}

int main()
{
  int pairs = 0;
  for (int k = 1; k <= 5; ++k)
    for (int n = k; n <= 12; ++n)
    {
      const auto dp = ranksumCounts(k, n);
      const auto bf = brute(k, n);
      for (size_t s = 0; s < dp.size(); ++s)
      {
        auto it = bf.find(static_cast<int>(s));
        const double want = (it == bf.end()) ? 0.0 : it->second;
        CHECK(dp[s] == want, "k=%d n=%d s=%zu dp=%.0f brute=%.0f", k, n, s, dp[s], want);
      }
      ++pairs;
    }
  std::printf("1. DP == exhaustive enumeration over %d (k,n) pairs\n", pairs);

  for (int k = 1; k <= 8; ++k)
    for (int n = k; n <= 60; n += 7)
    {
      double tot = 0;
      for (double v : ranksumCounts(k, n)) tot += v;
      const double want = binom(n, k);
      CHECK(std::fabs(tot - want) <= want * 1e-9, "k=%d n=%d total mismatch", k, n);
    }
  std::printf("2. sum(counts) == C(n,k)\n");

  for (int k = 2; k <= 8; ++k)
    for (int n = 20; n <= 150; n += 43)
    {
      const auto c = ranksumCdf(k, n);
      CHECK(!c.empty(), "empty cdf k=%d n=%d", k, n);
      for (size_t s = 1; s < c.size(); ++s)
        CHECK(c[s] >= c[s - 1], "cdf not monotone k=%d n=%d", k, n);
      CHECK(std::fabs(c.back() - 1.0f) < 1e-5f, "cdf ends at %.6f", c.back());
    }
  std::printf("3. CDF monotone and reaches 1\n");

  // Support starts at the sum of the k smallest ranks, reachable exactly one way.
  for (int k = 2; k <= 6; ++k)
  {
    const auto c = ranksumCounts(k, 40);
    const int smin = k * (k + 1) / 2;
    for (int s = 0; s < smin; ++s) CHECK(c[s] == 0.0, "mass below min sum k=%d", k);
    CHECK(c[smin] == 1.0, "min sum should be reachable exactly once, k=%d", k);
  }
  std::printf("4. support starts at k(k+1)/2 with a single subset\n");

  CHECK(ranksumCounts(0, 5).empty(), "k=0 must be empty");
  CHECK(ranksumCounts(9, 4).empty(), "k>n must be empty");
  std::printf("5. degenerate (k, n) return empty rather than misbehaving\n");

  // Tables builds every n at once; that must be ranksumCdf(k, n) exactly, bit
  // for bit, or the E-values move.
  for (int k = 1; k <= 8; ++k)
    for (int n_max : {k - 1, k, 17, 150, 400})
    {
      if (n_max == 400 && k > 4) continue;  // the per-n reference is O(n^3)
      const auto all = FASTag::ranksumCdfs(k, n_max);
      CHECK(all.size() == static_cast<size_t>(n_max) + 1, "ranksumCdfs size k=%d n_max=%d", k, n_max);
      for (int n = 0; n <= n_max && static_cast<size_t>(n) < all.size(); ++n)
        CHECK(all[static_cast<size_t>(n)] == (n < k ? std::vector<float>() : ranksumCdf(k, n)),
              "ranksumCdfs(%d, %d)[%d] != ranksumCdf", k, n_max, n);
    }
  std::printf("6. ranksumCdfs(k, n_max)[n] == ranksumCdf(k, n), bit for bit\n");

  std::printf(failures ? "\n%d FAILURES\n" : "\nall checks passed\n", failures);
  return failures ? 1 : 0;
}
