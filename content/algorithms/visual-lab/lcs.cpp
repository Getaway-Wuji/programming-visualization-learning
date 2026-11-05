#include <iostream>

int main() {
    int m; std::cin >> m; int a[8] = {};
    for (int i = 0; i < m; i = i + 1) { std::cin >> a[i]; }
    int n; std::cin >> n; int b[8] = {};
    for (int i = 0; i < n; i = i + 1) { std::cin >> b[i]; }
    int rows = m + 1; int cols = n + 1; int dp[81] = {};
    // 开始观察算法
    for (int i = 1; i <= m; i = i + 1) {
        for (int j = 1; j <= n; j = j + 1) {
            if (a[i - 1] == b[j - 1]) { dp[i * cols + j] = dp[(i - 1) * cols + j - 1] + 1; }
            else {
                int best = dp[(i - 1) * cols + j];
                if (dp[i * cols + j - 1] > best) { best = dp[i * cols + j - 1]; }
                dp[i * cols + j] = best;
            }
        }
    }
    std::cout << dp[m * cols + n] << "\n";
    return 0;
}
