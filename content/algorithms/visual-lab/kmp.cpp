#include <iostream>

int main() {
    int m; std::cin >> m; int a[8] = {};
    for (int i = 0; i < m; i = i + 1) { std::cin >> a[i]; }
    int n; std::cin >> n; int b[8] = {};
    for (int i = 0; i < n; i = i + 1) { std::cin >> b[i]; }

    int prefix[8] = {};
    // 开始观察算法
    for (int i = 1; i < n; i = i + 1) {
        int j = prefix[i - 1];
        while (j > 0 && b[i] != b[j]) { j = prefix[j - 1]; }
        if (b[i] == b[j]) { j = j + 1; }
        prefix[i] = j;
    }
    int j = 0; int found = 0;
    for (int i = 0; i < m; i = i + 1) {
        while (j > 0 && a[i] != b[j]) { j = prefix[j - 1]; }
        if (a[i] == b[j]) { j = j + 1; }
        if (j == n) { std::cout << i - n + 1 << " "; found = found + 1; j = prefix[j - 1]; }
    }
    if (found == 0) { std::cout << -1; }
    std::cout << "\n";
    return 0;
}
