#include <algorithm>
#include <array>
#include <cassert>
#include <cstdint>
#include <cstdio>
#include <string>
static std::string spell(uint8_t a, uint8_t b, uint8_t c, uint8_t order)
{
  std::string out;
  std::array<uint8_t, 3> r{a,b,c};
  for (uint8_t j = 0; j < order; ++j) std::next_permutation(r.begin(), r.end());
  for (auto j = r.rbegin(); j != r.rend(); ++j) out.push_back('A' + *j);
  return out;
}
int main()
{
  int count = 0;
  for (uint8_t a=0; a<19; ++a)
    for (uint8_t b=a; b<19; ++b)
      for (uint8_t c=b; c<19; ++c)
        for (uint8_t o=0; o<6; ++o)
        {
          auto s=spell(a,b,c,o);
          std::sort(s.begin(),s.end());
          assert(s.size()==3 && s[0]=='A'+a && s[1]=='A'+b && s[2]=='A'+c);
          ++count;
        }
  std::printf("ASan/UBSan exact permutation loop: %d cases passed\n",count);
}
