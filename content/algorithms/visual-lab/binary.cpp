#include <iostream>

int main() {
    int n;
    std::cin >> n;
    int a[12] = {};
    for (int i = 0; i < n; i = i + 1) {
        std::cin >> a[i];
    }
    int target; std::cin >> target;
    // 开始观察算法
    int found = -1;
    int lo = 0; int hi = n - 1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (a[mid] == target) { found = mid; break; }
        if (a[mid] < target) { lo = mid + 1; }
        else { hi = mid - 1; }
    }
    std::cout << found << "\n";
    return 0;
}
