#include <iostream>

int main() {
    int n; std::cin >> n; int dp[13] = {}; dp[0] = 1;
    // 开始观察算法
    if (n > 0) { dp[1] = 1; }
    for (int i = 2; i <= n; i = i + 1) { dp[i] = dp[i - 1] + dp[i - 2]; }
    std::cout << dp[n] << "\n";
    return 0;
}
