#include <iostream>
int main() {
  int n = {{n}};
  int values[30];
  int dp[30];
  for (int i = 0; i < n; i = i + 1) { std::cin >> values[i]; }
  int answer = 0;
  for (int i = 0; i < n; i = i + 1) {
    int best = 1;
    for (int j = 0; j < i; j = j + 1) {
      if (values[j] < values[i] && dp[j] + 1 > best) { best = dp[j] + 1; }
    }
    dp[i] = best;
    if (best > answer) { answer = best; }
  }
  std::cout << answer << "\n";
  return 0;
}
